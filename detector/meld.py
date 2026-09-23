"""
MELD, the local AI-text detector behind Slates' AI check.

The scoring head in this file is a transcription of the reference
implementation on the model card, not an interpretation of it. That matters
more than it looks: `pipeline()`, `AutoModelForSequenceClassification` and
`AutoModel` all load this repository without error, discard every weight in
it, and return confident numbers from a randomly initialised model. A subtly
wrong head does the same thing. If you change anything here, re-run
`detector/check.py`, which asserts against fixtures whose verdicts are known.

What the head does, in words: project each token's hidden state into a
low-rank "style" space, measure its distance to 32 human anchors and to 11
model-family prototypes, and take the log-odds that it looks more like a
family than like a human. The document score is the mean over the most
machine-like quarter of the tokens (rho = 0.25), so a human essay with one
pasted paragraph still moves the number. Flagging is against the offset
shipped in meld_config.json, which is the score below which 99% of human
validation texts fell — a 1% false-positive rate.

No network, no API key, nothing leaves the machine.
"""

from __future__ import annotations

import json
import os
import re

import torch
import torch.nn as nn
from safetensors.torch import load_file
from transformers import AutoConfig, AutoModel, AutoTokenizer

MODEL_DIR = os.environ.get(
    "SLATES_MELD_DIR", os.path.expanduser("~/.slates/meld/model")
)


class Meld(nn.Module):
    def __init__(self, model_dir: str):
        super().__init__()
        with open(f"{model_dir}/meld_config.json") as f:
            self.cfg = json.load(f)
        r, H = self.cfg["style_rank"], self.cfg["backbone_hidden_size"]
        self.backbone = AutoModel.from_config(
            AutoConfig.from_pretrained(model_dir), attn_implementation="sdpa"
        )
        self.style_proj = nn.Linear(H, r, bias=False)
        self.style_ln = nn.LayerNorm(r)
        self.human_anchors = nn.Parameter(torch.zeros(self.cfg["n_human_anchors"], r))
        self.family_protos = nn.Parameter(torch.zeros(self.cfg["n_families"], r))
        self.family_bias = nn.Parameter(torch.zeros(self.cfg["n_families"]))
        self.log_tau = nn.Parameter(torch.zeros(()))
        self.op_protos = nn.Parameter(torch.zeros(self.cfg["n_ops"], r))
        self.op_bias = nn.Parameter(torch.zeros(self.cfg["n_ops"]))
        # strict=True on purpose: a rename upstream should fail loudly here
        # rather than leave part of the head at zero.
        self.load_state_dict(load_file(f"{model_dir}/model.safetensors"), strict=True)
        self.eval()

    @torch.no_grad()
    def per_token(self, enc):
        """Log-odds per token that this token reads as machine-written."""
        valid = enc["attention_mask"].bool() & ~enc["special_tokens_mask"].bool()
        h = self.backbone(
            input_ids=enc["input_ids"], attention_mask=enc["attention_mask"]
        ).last_hidden_state.float()

        u = self.style_ln(self.style_proj(h))
        tau = self.log_tau.clamp(-4.0, 4.0).exp()

        def sqdist(u, p):
            return (
                (u * u).sum(-1, keepdim=True)
                - 2.0 * u @ p.t()
                + (p * p).sum(-1).view(1, 1, -1)
            )

        human = torch.logsumexp(-tau * sqdist(u, self.human_anchors), -1, keepdim=True)
        family = -tau * sqdist(u, self.family_protos) + self.family_bias.view(1, 1, -1)
        tokens = self.cfg["tau_agg"] * torch.logsumexp(
            (family - human).clamp(-30.0, 30.0) / self.cfg["tau_agg"], dim=-1
        )
        return tokens, valid

    @staticmethod
    def aggregate(tokens: torch.Tensor, valid: torch.Tensor, rho: float) -> torch.Tensor:
        """Mean of the most machine-like `rho` fraction of the valid tokens."""
        x = tokens.masked_fill(~valid, torch.finfo(tokens.dtype).min)
        x, _ = x.sort(dim=1, descending=True)
        k = (valid.sum(1).clamp(min=1) * rho).ceil().clamp(min=1).long()
        keep = torch.arange(x.shape[1], device=x.device).unsqueeze(0) < k.unsqueeze(1)
        return torch.where(keep, x, torch.zeros_like(x)).sum(1) / k.float()

    @torch.no_grad()
    def score(self, texts, tokenizer, device="cpu"):
        """Returns (P(AI) in [0,1], raw score) per text — the card's own method."""
        enc = tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=self.cfg["max_length"],
            return_special_tokens_mask=True,
        ).to(device)
        tokens, valid = self.per_token(enc)
        s = self.aggregate(tokens, valid, self.cfg["rho"])
        return torch.sigmoid(s).tolist(), s.tolist()


_SENTENCE = re.compile(r"[^.!?]*[.!?]+[\"'’”]?\s*|[^.!?]+$")


def _sentences(text: str):
    """Character spans, matching how the essay view splits the same draft."""
    out = []
    for m in _SENTENCE.finditer(text):
        raw = m.group(0)
        if not raw.strip():
            continue
        lead = len(raw) - len(raw.lstrip())
        start = m.start() + lead
        out.append((start, start + len(raw.strip())))
    return out


class Detector:
    """Loaded once, scored many times — see detector/serve.py."""

    def __init__(self, model_dir: str = MODEL_DIR, device: str = "cpu"):
        self.device = device
        self.model = Meld(model_dir).to(device)
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        self.threshold = self.model.cfg["score_offsets"]["overall"]["fpr_0.01"]

    def score(self, text: str) -> dict:
        enc = self.tokenizer(
            [text],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=self.model.cfg["max_length"],
            return_special_tokens_mask=True,
            return_offsets_mapping=True,
        )
        offsets = enc.pop("offset_mapping")[0].tolist()
        enc = enc.to(self.device)

        tokens, valid = self.model.per_token(enc)
        s = self.model.aggregate(tokens, valid, self.model.cfg["rho"])[0].item()

        # Per-sentence numbers come from the same forward pass, aggregated over
        # each sentence's own tokens. Running sentences separately would be both
        # slower and less honest — the card asks for 100+ words per score, so a
        # sentence read alone is out of distribution.
        row = tokens[0]
        ok = valid[0]
        rho = self.model.cfg["rho"]
        spans = []
        for start, end in _sentences(text):
            idx = [
                i
                for i, (a, b) in enumerate(offsets)
                if ok[i] and a < end and b > start and b > a
            ]
            if not idx:
                continue
            sub = row[idx].unsqueeze(0)
            sub_valid = torch.ones_like(sub, dtype=torch.bool)
            spans.append(
                {
                    "text": text[start:end],
                    "start": start,
                    "end": end,
                    "score": self.model.aggregate(sub, sub_valid, rho)[0].item(),
                }
            )

        return {
            "p": torch.sigmoid(torch.tensor(s)).item(),
            "score": s,
            "threshold": self.threshold,
            "flagged": s > self.threshold,
            "tokens_read": int(ok.sum().item()),
            "truncated": int(ok.sum().item()) >= self.model.cfg["max_length"] - 2,
            "sentences": spans,
        }
