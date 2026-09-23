import "server-only";

import { createOpenAI, openai as defaultOpenai } from "@ai-sdk/openai";
import { createOpenRouter, openrouter as defaultOpenrouter } from "@openrouter/ai-sdk-provider";

import { activeApiSecret, hasSecret as storeHasSecret } from "./store";
import type { UsageProvider } from "./types";

/**
 * Provider clients that pick up the active linked key.
 *
 * When a linked API plan is in use and its key differs from the env default,
 * we build a fresh client with that key. Otherwise we keep the stock export
 * so behaviour matches the rest of Slates when nothing is linked.
 */

export function activeApiSecretFor(provider: UsageProvider): string | null {
  return activeApiSecret(provider);
}

export function hasSecret(provider: UsageProvider): boolean {
  return storeHasSecret(provider);
}

export function openaiProvider() {
  const linked = activeApiSecret("openai");
  const env = process.env.OPENAI_API_KEY?.trim() || null;
  if (linked && linked !== env) {
    return createOpenAI({ apiKey: linked });
  }
  return defaultOpenai;
}

export function openaiModel(modelId: string) {
  return openaiProvider()(modelId);
}

export function openrouterProvider() {
  const linked = activeApiSecret("openrouter");
  const env = process.env.OPENROUTER_API_KEY?.trim() || null;
  if (linked && linked !== env) {
    return createOpenRouter({ apiKey: linked });
  }
  return defaultOpenrouter;
}

export function openrouterModel(modelId: string) {
  return openrouterProvider()(modelId);
}

export { activeApiSecret };
