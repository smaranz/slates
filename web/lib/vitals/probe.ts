import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sensorKind } from "./parse";

/**
 * Two small helpers, compiled on this Mac the first time Vitals needs them.
 *
 * `ps` can read every process (it runs as root), but only its resident size,
 * which isn't the memory Activity Monitor shows, and nothing about energy or
 * disk. The kernel answers those for the student's own processes through
 * `proc_pid_rusage`, and says which app is responsible for each one, which is
 * how a Chrome renderer or a `node` started in a terminal is filed under its
 * app. No command prints those, so the probe asks for them itself.
 *
 * App icons come from AppKit, which reads the asset catalogs `sips` can't.
 *
 * Built with the Xcode command line tools when they're installed (checked
 * first, since running `cc` without them opens Apple's install dialog), and
 * kept in ~/.slates/vitals under a hash of their source, so a change here
 * rebuilds them. Without the tools Vitals still works from `ps`.
 */

/*
 * One line per fact, tagged by its first field:
 *   X pid path                                    every process's executable
 *   P pid responsible footprint nJ read written cwd   the student's own processes
 *   G busy% renderer% tiler% bytes cores model    the GPU
 *   C pid ns                                      GPU time each process has used
 *   D read written                                bytes through every disk since boot
 *
 * `probe smc-keys` lists the SMC's temperature keys, one `K key` a line. It
 * walks all of them (about 3,000 on an M4 Pro, 1.5 s), so it's asked once.
 * `probe sensors <key>…` reads those keys and the rest of what the SMC knows
 * about heat:
 *   T key °C                                      a temperature
 *   F fan rpm min max target manual               each fan
 *   W watts                                       the whole Mac's draw (PSTR)
 *   H level                                       thermal pressure, 0 (nominal) to 4
 */
const PROBE_C = String.raw`
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <dlfcn.h>
#include <libproc.h>
#include <notify.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

typedef pid_t (*responsible_fn)(pid_t);

static void clean(char *s) {
  for (; *s; s++) if (*s == '\t' || *s == '\n' || *s == '\r') *s = ' ';
}

static long long number(CFTypeRef value) {
  long long out = 0;
  if (value && CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue((CFNumberRef)value, kCFNumberLongLongType, &out);
  return out;
}

static long long field(CFTypeRef dict, CFStringRef key) {
  if (!dict || CFGetTypeID(dict) != CFDictionaryGetTypeID()) return 0;
  return number(CFDictionaryGetValue((CFDictionaryRef)dict, key));
}

static CFTypeRef property(io_object_t entry, CFStringRef key) {
  return IORegistryEntryCreateCFProperty(entry, key, kCFAllocatorDefault, 0);
}

static void processes(void) {
  responsible_fn responsible = (responsible_fn)dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
  int n = proc_listallpids(NULL, 0);
  if (n <= 0) return;
  int cap = n + 256;
  pid_t *pids = calloc((size_t)cap, sizeof(pid_t));
  if (!pids) return;
  n = proc_listallpids(pids, cap * (int)sizeof(pid_t));
  for (int i = 0; i < n; i++) {
    char path[PROC_PIDPATHINFO_MAXSIZE] = "";
    if (proc_pidpath(pids[i], path, sizeof path) <= 0 && proc_name(pids[i], path, sizeof path) <= 0) path[0] = 0;
    clean(path);
    if (path[0]) printf("X\t%d\t%s\n", pids[i], path);

    struct rusage_info_v6 ri;
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V6, (rusage_info_t *)&ri) != 0) continue;
    pid_t owner = responsible ? responsible(pids[i]) : 0;
    struct proc_vnodepathinfo vpi;
    char cwd[MAXPATHLEN] = "";
    if (proc_pidinfo(pids[i], PROC_PIDVNODEPATHINFO, 0, &vpi, sizeof vpi) == (int)sizeof vpi) {
      snprintf(cwd, sizeof cwd, "%s", vpi.pvi_cdir.vip_path);
      clean(cwd);
    }
    printf("P\t%d\t%d\t%llu\t%llu\t%llu\t%llu\t%s\n", pids[i], owner > 0 ? owner : 0,
           (unsigned long long)ri.ri_phys_footprint, (unsigned long long)ri.ri_energy_nj,
           (unsigned long long)ri.ri_diskio_bytesread, (unsigned long long)ri.ri_diskio_byteswritten, cwd);
  }
  free(pids);
}

static void gpu(void) {
  io_iterator_t it;
  if (IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &it) != KERN_SUCCESS) return;
  io_object_t accel;
  while ((accel = IOIteratorNext(it))) {
    CFTypeRef perf = property(accel, CFSTR("PerformanceStatistics"));
    CFTypeRef model = property(accel, CFSTR("model"));
    CFTypeRef cores = property(accel, CFSTR("gpu-core-count"));
    char name[128] = "GPU";
    if (model && CFGetTypeID(model) == CFStringGetTypeID()) CFStringGetCString((CFStringRef)model, name, sizeof name, kCFStringEncodingUTF8);
    clean(name);
    if (perf) {
      printf("G\t%lld\t%lld\t%lld\t%lld\t%lld\t%s\n", field(perf, CFSTR("Device Utilization %")), field(perf, CFSTR("Renderer Utilization %")),
             field(perf, CFSTR("Tiler Utilization %")), field(perf, CFSTR("In use system memory")), number(cores), name);
    }
    if (perf) CFRelease(perf);
    if (model) CFRelease(model);
    if (cores) CFRelease(cores);

    io_iterator_t clients;
    if (IORegistryEntryGetChildIterator(accel, kIOServicePlane, &clients) == KERN_SUCCESS) {
      io_object_t client;
      while ((client = IOIteratorNext(clients))) {
        CFTypeRef creator = property(client, CFSTR("IOUserClientCreator"));
        CFTypeRef usage = property(client, CFSTR("AppUsage"));
        char who[160] = "";
        int pid = 0;
        if (creator && CFGetTypeID(creator) == CFStringGetTypeID() && CFStringGetCString((CFStringRef)creator, who, sizeof who, kCFStringEncodingUTF8)) sscanf(who, "pid %d", &pid);
        long long total = 0;
        if (usage && CFGetTypeID(usage) == CFArrayGetTypeID()) {
          for (CFIndex i = 0; i < CFArrayGetCount((CFArrayRef)usage); i++) total += field(CFArrayGetValueAtIndex((CFArrayRef)usage, i), CFSTR("accumulatedGPUTime"));
        }
        if (pid > 0 && total > 0) printf("C\t%d\t%lld\n", pid, total);
        if (creator) CFRelease(creator);
        if (usage) CFRelease(usage);
        IOObjectRelease(client);
      }
      IOObjectRelease(clients);
    }
    IOObjectRelease(accel);
  }
  IOObjectRelease(it);
}

static void disks(void) {
  io_iterator_t it;
  if (IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOBlockStorageDriver"), &it) != KERN_SUCCESS) return;
  long long read = 0, written = 0;
  io_object_t disk;
  while ((disk = IOIteratorNext(it))) {
    CFTypeRef stats = property(disk, CFSTR("Statistics"));
    read += field(stats, CFSTR("Bytes (Read)"));
    written += field(stats, CFSTR("Bytes (Write)"));
    if (stats) CFRelease(stats);
    IOObjectRelease(disk);
  }
  IOObjectRelease(it);
  printf("D\t%lld\t%lld\n", read, written);
}

/* The SMC answers one struct in, one out; its layout is the kernel's own. */
typedef struct { char major, minor, build, reserved; uint16_t release; } SMCVersion;
typedef struct { uint16_t version, length; uint32_t cpu, gpu, mem; } SMCLimits;
typedef struct { uint32_t size, type; uint8_t attributes; } SMCKeyInfo;
typedef struct {
  uint32_t key;
  SMCVersion version;
  SMCLimits limits;
  SMCKeyInfo info;
  uint8_t result, status, command;
  uint32_t index;
  uint8_t bytes[32];
} SMCParam;

enum { SMC_READ = 5, SMC_AT_INDEX = 8, SMC_INFO = 9 };
static io_connect_t smc;

static uint32_t fourcc(const char *s) {
  return (uint32_t)(uint8_t)s[0] << 24 | (uint32_t)(uint8_t)s[1] << 16 | (uint32_t)(uint8_t)s[2] << 8 | (uint32_t)(uint8_t)s[3];
}

static int smc_call(SMCParam *in, SMCParam *out) {
  size_t size = sizeof *out;
  memset(out, 0, sizeof *out);
  return IOConnectCallStructMethod(smc, 2, in, sizeof *in, out, &size) == KERN_SUCCESS && out->result == 0;
}

static int smc_open(void) {
  io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
  if (!service) return 0;
  kern_return_t ok = IOServiceOpen(service, mach_task_self(), 0, &smc);
  IOObjectRelease(service);
  return ok == KERN_SUCCESS;
}

static int smc_info(uint32_t key, SMCKeyInfo *info) {
  SMCParam in = {0}, out;
  in.key = key;
  in.command = SMC_INFO;
  if (!smc_call(&in, &out)) return 0;
  *info = out.info;
  return 1;
}

static int smc_bytes(uint32_t key, uint32_t size, uint8_t *bytes) {
  SMCParam in = {0}, out;
  in.key = key;
  in.info.size = size;
  in.command = SMC_READ;
  if (!smc_call(&in, &out)) return 0;
  memcpy(bytes, out.bytes, sizeof out.bytes);
  return 1;
}

/* Any number the SMC keeps: Apple silicon writes floats, older Macs fixed point. */
static int smc_number(const char *name, double *value) {
  SMCKeyInfo info;
  uint8_t b[32];
  uint32_t key = fourcc(name);
  if (!smc_info(key, &info) || !smc_bytes(key, info.size, b)) return 0;
  if (info.type == fourcc("flt ") && info.size == 4) { float f; memcpy(&f, b, 4); *value = f; }
  else if (info.type == fourcc("fpe2") && info.size == 2) *value = ((b[0] << 8) | b[1]) / 4.0;
  else if (info.type == fourcc("sp78") && info.size == 2) *value = (int16_t)((b[0] << 8) | b[1]) / 256.0;
  else if (info.type == fourcc("ui8 ") || info.type == fourcc("flag")) *value = b[0];
  else if (info.type == fourcc("ui16")) *value = (b[0] << 8) | b[1];
  else if (info.type == fourcc("ui32")) *value = (uint32_t)b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3];
  else return 0;
  return 1;
}

static void smc_keys(void) {
  double count;
  if (!smc_number("#KEY", &count)) return;
  for (uint32_t i = 0; i < (uint32_t)count; i++) {
    SMCParam in = {0}, out;
    in.command = SMC_AT_INDEX;
    in.index = i;
    if (!smc_call(&in, &out) || (out.key >> 24) != 'T') continue;
    SMCKeyInfo info;
    if (!smc_info(out.key, &info) || info.type != fourcc("flt ") || info.size != 4) continue;
    printf("K\t%c%c%c%c\n", (char)(out.key >> 24), (char)(out.key >> 16), (char)(out.key >> 8), (char)out.key);
  }
}

static void sensors(int argc, char **argv) {
  /* Temperatures are all 4-byte floats (smc-keys keeps only those), so one call each. */
  for (int i = 0; i < argc; i++) {
    uint8_t b[32];
    float f;
    if (strlen(argv[i]) != 4 || !smc_bytes(fourcc(argv[i]), 4, b)) continue;
    memcpy(&f, b, 4);
    printf("T\t%s\t%.2f\n", argv[i], f);
  }
  double fans = 0;
  smc_number("FNum", &fans);
  for (int i = 0; i < (int)fans && i < 10; i++) {
    char key[5];
    double rpm = 0, min = 0, max = 0, target = -1, mode = 0;
    snprintf(key, sizeof key, "F%dAc", i);
    if (!smc_number(key, &rpm)) continue;
    snprintf(key, sizeof key, "F%dMn", i);
    smc_number(key, &min);
    snprintf(key, sizeof key, "F%dMx", i);
    smc_number(key, &max);
    snprintf(key, sizeof key, "F%dTg", i);
    smc_number(key, &target);
    snprintf(key, sizeof key, "F%dMd", i);
    smc_number(key, &mode);
    printf("F\t%d\t%.0f\t%.0f\t%.0f\t%.0f\t%d\n", i, rpm, min, max, target, mode > 0);
  }
  double watts;
  if (smc_number("PSTR", &watts)) printf("W\t%.2f\n", watts);
}

static void pressure(void) {
  int token;
  uint64_t level = 0;
  if (notify_register_check("com.apple.system.thermalpressurelevel", &token) != NOTIFY_STATUS_OK) return;
  if (notify_get_state(token, &level) == NOTIFY_STATUS_OK) printf("H\t%llu\n", (unsigned long long)level);
  notify_cancel(token);
}

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "smc-keys")) {
    if (smc_open()) smc_keys();
    return 0;
  }
  if (argc > 1 && !strcmp(argv[1], "sensors")) {
    if (smc_open()) sensors(argc - 2, argv + 2);
    pressure();
    return 0;
  }
  processes();
  gpu();
  disks();
  return 0;
}
`;

const ICONS_M = String.raw`
#import <AppKit/AppKit.h>

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc < 3) return 1;
    int size = atoi(argv[1]);
    if (size < 16 || size > 512) size = 64;
    for (int i = 2; i < argc; i++) {
      NSString *bundle = [NSString stringWithUTF8String:argv[i]];
      NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:bundle];
      NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:size pixelsHigh:size
        bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
      if (!icon || !rep) { printf("%d\t\n", i - 2); continue; }
      [NSGraphicsContext saveGraphicsState];
      [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:rep]];
      [icon drawInRect:NSMakeRect(0, 0, size, size) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0];
      [NSGraphicsContext restoreGraphicsState];
      NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
      printf("%d\t%s\n", i - 2, png ? [[png base64EncodedStringWithOptions:0] UTF8String] : "");
    }
  }
  return 0;
}
`;

const dir = () => path.join(os.homedir(), ".slates", "vitals");

function run(file: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

let toolsChecked: Promise<boolean> | null = null;

/** Whether the command line tools are installed; asks without triggering Apple's installer. */
function hasTools(): Promise<boolean> {
  toolsChecked ??= run("/usr/bin/xcode-select", ["-p"], 5_000).then(
    (out) => out.trim().length > 0,
    () => false,
  );
  return toolsChecked;
}

const built = new Map<string, Promise<string | null>>();

async function build(name: string, source: string, flags: string[]): Promise<string | null> {
  if (process.platform !== "darwin" || !(await hasTools())) return null;
  const hash = createHash("sha256").update(source).update(flags.join(" ")).digest("hex").slice(0, 12);
  const bin = path.join(dir(), `${name}-${hash}`);
  try {
    await fs.access(bin, fs.constants.X_OK);
    return bin;
  } catch {
    /* not built yet */
  }
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  const ext = flags.includes("objective-c") ? "m" : "c";
  const src = `${bin}.${process.pid}.${ext}`;
  const tmp = `${bin}.${process.pid}.tmp`;
  try {
    await fs.writeFile(src, source, { mode: 0o600 });
    await run("/usr/bin/cc", [...flags, "-O2", "-o", tmp, src], 120_000);
    await fs.chmod(tmp, 0o700);
    await fs.rename(tmp, bin);
    return bin;
  } catch (err) {
    console.error(`[vitals] couldn't build ${name}:`, (err as { stderr?: string }).stderr || err);
    return null;
  } finally {
    await fs.rm(src, { force: true });
    await fs.rm(tmp, { force: true });
  }
}

function helper(name: string, source: string, flags: string[]): Promise<string | null> {
  let pending = built.get(name);
  if (!pending) {
    pending = build(name, source, flags);
    built.set(name, pending);
  }
  return pending;
}

const PROBE_FLAGS = ["-x", "c", "-framework", "IOKit", "-framework", "CoreFoundation"];

/** The probe, built if it can be; null without the command line tools. */
export function probeBinary(): Promise<string | null> {
  return helper("probe", PROBE_C, PROBE_FLAGS);
}

/** Why the probe isn't running, for the room to say once; null when it is. */
export async function probeMissing(): Promise<string | null> {
  if (!(await hasTools())) return "Install Apple's command line tools (xcode-select --install) for memory as Activity Monitor counts it, and power and disk by app.";
  return (await probeBinary()) ? null : "The memory probe didn't build, so memory is resident size and power and disk aren't split by app.";
}

/** The probe's output, or null without it. */
export async function readProbe(): Promise<string | null> {
  const bin = await probeBinary();
  if (!bin) return null;
  try {
    return await run(bin, [], 5_000);
  } catch {
    return null;
  }
}

let smcKeys: Promise<string[] | null> | null = null;

/** The SMC's temperature keys that Vitals shows, listed once: they're the same until the Mac changes. */
function temperatureKeys(bin: string): Promise<string[] | null> {
  smcKeys ??= run(bin, ["smc-keys"], 15_000).then(
    (out) => out.split("\n").flatMap((line) => /^K\t(T[A-Za-z0-9]{3})$/.exec(line)?.slice(1, 2) ?? []).filter((key) => sensorKind(key) !== null),
    () => {
      smcKeys = null;
      return null;
    },
  );
  return smcKeys;
}

/** The SMC's temperatures, fans and draw, and the thermal pressure; null without the probe. */
export async function readSensors(): Promise<string | null> {
  const bin = await probeBinary();
  if (!bin) return null;
  const keys = await temperatureKeys(bin);
  try {
    return await run(bin, ["sensors", ...(keys ?? [])], 5_000);
  } catch {
    return null;
  }
}

/* ── icons ─────────────────────────────────────────────────────────────── */

const ICON_PX = 64;
const iconDir = () => path.join(dir(), "icons");
const iconFile = (bundle: string) => path.join(iconDir(), `${createHash("sha1").update(bundle).digest("hex")}-${ICON_PX}.png`);

/** PNG data URLs for app bundles, made once each and kept on disk. */
export async function appIcons(bundles: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(bundles)].filter((b) => b.startsWith("/") && b.endsWith(".app") && !b.includes("\0")).slice(0, 120);
  const icons: Record<string, string> = {};
  const missing: string[] = [];
  await Promise.all(
    wanted.map(async (bundle) => {
      try {
        icons[bundle] = `data:image/png;base64,${(await fs.readFile(iconFile(bundle))).toString("base64")}`;
      } catch {
        missing.push(bundle);
      }
    }),
  );

  const real: string[] = [];
  await Promise.all(
    missing.map(async (bundle) => {
      const stat = await fs.stat(bundle).catch(() => null);
      if (stat?.isDirectory()) real.push(bundle);
    }),
  );
  if (!real.length) return icons;

  const bin = await helper("icons", ICONS_M, ["-x", "objective-c", "-fobjc-arc", "-framework", "AppKit"]);
  if (!bin) return icons;
  let out = "";
  try {
    out = await run(bin, [String(ICON_PX), ...real], 30_000);
  } catch {
    return icons;
  }
  await fs.mkdir(iconDir(), { recursive: true, mode: 0o700 });
  for (const line of out.split("\n")) {
    const [index, data] = line.split("\t");
    const bundle = real[Number(index)];
    if (!bundle || !data) continue;
    icons[bundle] = `data:image/png;base64,${data}`;
    await fs.writeFile(iconFile(bundle), Buffer.from(data, "base64"), { mode: 0o600 }).catch(() => {});
  }
  return icons;
}
