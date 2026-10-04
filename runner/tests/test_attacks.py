"""Sandbox attack tests in all four languages (coding assessments, stage C5), against real Docker.

Each language runs a *probe* — a program that tries to break out — plus the classic resource attacks.
Skipped when Docker or the language's image is missing.

What is asserted, in Python, C, C++ and Java alike:
* **No network.** Connecting out fails.
* **Read-only.** The code folder and the system cannot be written; only a small private /tmp can.
* **No host access.** No Docker socket; the runner's token is neither in the program's environment nor
  in any process inside the sandbox.
* **No privilege.** The program runs as nobody (65534) with no capabilities.
* **Nothing carries over.** A file written in one test is gone in the next, so a hidden test's input
  can never be smuggled into a sample test's visible output.
* **Limits hold.** Infinite loops hit the time limit; memory bombs hit the memory limit (or crash);
  endless output hits the output limit; fork and thread bombs are contained; a compile-time bomb is
  stopped. The runner survives every one and leaves no container behind.
"""

import subprocess

import pytest
from test_sandbox import GCC, JAVA, PY, _have, job

from assessx_runner.sandbox import run_job

TOKEN = "attack-test-runner-token-0123456789abcdef"
IMAGES = {"python": PY, "c": GCC, "cpp": GCC, "java": JAVA}
LANGS = [pytest.param(lang, marks=pytest.mark.skipif(not _have(IMAGES[lang]), reason=f"{IMAGES[lang]} not available")) for lang in IMAGES]

PROBE_PY = r"""
import os, socket, sys
mode = sys.stdin.read().strip()
stash = "FOUND" if os.path.exists("/tmp/stash") else "CLEAN"
if mode == "first":
    open("/tmp/stash", "w").write("hidden-input")
def net():
    try:
        socket.create_connection(("1.1.1.1", 53), timeout=2)
        return "OPEN"
    except OSError:
        return "BLOCKED"
def write(path):
    try:
        with open(path, "w") as handle:
            handle.write("x")
        return "OK"
    except OSError:
        return "DENIED"
def token():
    if os.environ.get("RUNNER_TOKEN"):
        return "PRESENT"
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                if b"RUNNER_TOKEN" in open(f"/proc/{pid}/environ", "rb").read():
                    return "PRESENT"
            except OSError:
                pass
    return "ABSENT"
status = open("/proc/self/status").read().splitlines()
field = lambda key: next(line.split()[1] for line in status if line.startswith(key + ":"))
print("net=" + net())
print("write_work=" + write("/work/x"))
print("write_etc=" + write("/etc/x"))
print("write_usr=" + write("/usr/x"))
print("write_tmp=" + write("/tmp/y"))
print("docker_sock=" + ("PRESENT" if os.path.exists("/var/run/docker.sock") else "ABSENT"))
print("token=" + token())
print("uid=" + field("Uid"))
print("capeff=" + field("CapEff"))
print("stash=" + stash)
"""

# Valid C and valid C++: the same probe is compiled by gcc and by g++.
PROBE_C = r"""
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

static const char *net(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return "BLOCKED";
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons(53);
    inet_pton(AF_INET, "1.1.1.1", &a.sin_addr);
    int r = connect(s, (struct sockaddr *)&a, sizeof a);
    close(s);
    return r == 0 ? "OPEN" : "BLOCKED";
}
static const char *wr(const char *path) {
    FILE *f = fopen(path, "w");
    if (!f) return "DENIED";
    fputs("x", f);
    return fclose(f) == 0 ? "OK" : "DENIED";
}
static int has(const char *path, const char *needle) {
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    static char buf[65536];
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    for (size_t i = 0; i < n; i++) if (buf[i] == 0) buf[i] = '\n';
    buf[n] = 0;
    return strstr(buf, needle) != NULL;
}
static const char *token(void) {
    if (getenv("RUNNER_TOKEN")) return "PRESENT";
    DIR *d = opendir("/proc");
    struct dirent *e;
    char path[300];
    int found = 0;
    while (d && (e = readdir(d))) {
        if (e->d_name[0] < '0' || e->d_name[0] > '9') continue;
        snprintf(path, sizeof path, "/proc/%s/environ", e->d_name);
        if (has(path, "RUNNER_TOKEN")) found = 1;
    }
    if (d) closedir(d);
    return found ? "PRESENT" : "ABSENT";
}
static void field(const char *key, const char *label) {
    FILE *f = fopen("/proc/self/status", "r");
    char line[512], value[128];
    size_t k = strlen(key);
    while (f && fgets(line, sizeof line, f)) {
        if (strncmp(line, key, k) == 0 && line[k] == ':' && sscanf(line + k + 1, "%127s", value) == 1) {
            printf("%s=%s\n", label, value);
            break;
        }
    }
    if (f) fclose(f);
}
int main(void) {
    char mode[16] = {0};
    if (scanf("%15s", mode) != 1) mode[0] = 0;
    const char *stash = access("/tmp/stash", F_OK) == 0 ? "FOUND" : "CLEAN";
    if (strcmp(mode, "first") == 0) {
        FILE *f = fopen("/tmp/stash", "w");
        if (f) { fputs("hidden-input", f); fclose(f); }
    }
    printf("net=%s\n", net());
    printf("write_work=%s\n", wr("/work/x"));
    printf("write_etc=%s\n", wr("/etc/x"));
    printf("write_usr=%s\n", wr("/usr/x"));
    printf("write_tmp=%s\n", wr("/tmp/y"));
    printf("docker_sock=%s\n", access("/var/run/docker.sock", F_OK) == 0 ? "PRESENT" : "ABSENT");
    printf("token=%s\n", token());
    field("Uid", "uid");
    field("CapEff", "capeff");
    printf("stash=%s\n", stash);
    return 0;
}
"""

PROBE_JAVA = r"""
import java.io.*;
import java.net.*;
import java.nio.file.*;

public class Main {
    static String net() {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("1.1.1.1", 53), 2000);
            return "OPEN";
        } catch (IOException e) {
            return "BLOCKED";
        }
    }
    static String write(String p) {
        try {
            Files.writeString(Path.of(p), "x");
            return "OK";
        } catch (IOException e) {
            return "DENIED";
        }
    }
    static String token() {
        if (System.getenv("RUNNER_TOKEN") != null) return "PRESENT";
        File[] all = new File("/proc").listFiles();
        if (all != null) for (File f : all) {
            if (!f.getName().matches("\\d+")) continue;
            try {
                if (new String(Files.readAllBytes(f.toPath().resolve("environ"))).contains("RUNNER_TOKEN")) return "PRESENT";
            } catch (IOException e) {
                // not readable: fine
            }
        }
        return "ABSENT";
    }
    static String field(String key) throws IOException {
        for (String line : Files.readAllLines(Path.of("/proc/self/status")))
            if (line.startsWith(key + ":")) return line.substring(key.length() + 1).trim().split("\\s+")[0];
        return "?";
    }
    public static void main(String[] args) throws IOException {
        String mode = new BufferedReader(new InputStreamReader(System.in)).readLine();
        String stash = Files.exists(Path.of("/tmp/stash")) ? "FOUND" : "CLEAN";
        if ("first".equals(mode)) Files.writeString(Path.of("/tmp/stash"), "hidden-input");
        System.out.println("net=" + net());
        System.out.println("write_work=" + write("/work/x"));
        System.out.println("write_etc=" + write("/etc/x"));
        System.out.println("write_usr=" + write("/usr/x"));
        System.out.println("write_tmp=" + write("/tmp/y"));
        System.out.println("docker_sock=" + (Files.exists(Path.of("/var/run/docker.sock")) ? "PRESENT" : "ABSENT"));
        System.out.println("token=" + token());
        System.out.println("uid=" + field("Uid"));
        System.out.println("capeff=" + field("CapEff"));
        System.out.println("stash=" + stash);
    }
}
"""

PROBES = {"python": PROBE_PY, "c": PROBE_C, "cpp": PROBE_C, "java": PROBE_JAVA}

EXPECTED = {
    "net": "BLOCKED",
    "write_work": "DENIED",
    "write_etc": "DENIED",
    "write_usr": "DENIED",
    "write_tmp": "OK",
    "docker_sock": "ABSENT",
    "token": "ABSENT",
    "uid": "65534",
    "capeff": "0000000000000000",
    "stash": "CLEAN",
}

INFINITE_LOOP = {
    "python": "while True:\n    pass\n",
    "c": "int main(void) { volatile unsigned long x = 0; for (;;) x++; }\n",
    "cpp": "int main() { volatile unsigned long x = 0; for (;;) x++; }\n",
    "java": "public class Main { public static void main(String[] a) { long x = 0; while (true) { x++; if (x == -1) break; } } }\n",
}
MEMORY_BOMB = {
    "python": "chunks = []\nwhile True:\n    chunks.append(bytearray(1 << 20))\n",
    "c": "#include <stdlib.h>\n#include <string.h>\nint main(void) { for (;;) { char *p = malloc(1 << 20); if (!p) return 3; memset(p, 1, 1 << 20); } }\n",
    "cpp": "#include <vector>\nint main() { std::vector<std::vector<char>> v; for (;;) v.emplace_back(1 << 20, 'x'); }\n",
    "java": "import java.util.*;\npublic class Main { public static void main(String[] a) { List<long[]> l = new ArrayList<>(); while (true) l.add(new long[1 << 17]); } }\n",
}
OUTPUT_FLOOD = {
    "python": "while True:\n    print('x' * 1000)\n",
    "c": "#include <stdio.h>\nint main(void) { for (;;) fputs(\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n\", stdout); }\n",
    "cpp": "#include <iostream>\n#include <string>\nint main() { std::string s(1000, 'x'); for (;;) std::cout << s << '\\n'; }\n",
    "java": "public class Main { public static void main(String[] a) { String s = \"x\".repeat(1000); while (true) System.out.println(s); } }\n",
}
FORK_BOMB = {
    "python": "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass\n",
    "c": "#include <unistd.h>\nint main(void) { for (;;) fork(); }\n",
    "cpp": "#include <unistd.h>\nint main() { for (;;) fork(); }\n",
    "java": (
        "public class Main { public static void main(String[] a) { while (true) { "
        "Thread t = new Thread(() -> { try { Thread.sleep(1_000_000); } catch (InterruptedException e) { } }); "
        "t.start(); } } }\n"
    ),
}

#: Java needs more room for its own runtime; the rest use small limits so attacks end quickly.
LIMITS = {"python": (1500, 96), "c": (1000, 64), "cpp": (1000, 64), "java": (3000, 384)}


def attack(lang: str, source: str, tests: list[str]) -> dict:
    time_ms, memory_mb = LIMITS[lang]
    report = run_job(job(source, tests, lang=lang, time_ms=time_ms, memory_mb=memory_mb))
    assert report["compile"] is None or report["compile"]["ok"], report["compile"]
    return report


def no_containers_left() -> bool:
    left = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "label=assessx-runner=1"], capture_output=True, text=True, check=False
    )
    return left.stdout.strip() == ""


@pytest.mark.parametrize("lang", LANGS)
def test_the_probe_finds_no_way_out(lang, monkeypatch):
    monkeypatch.setenv("RUNNER_TOKEN", TOKEN)  # the runner's own environment holds a token
    time_ms, memory_mb = LIMITS[lang]
    report = run_job(job(PROBES[lang], ["first\n", "second\n"], lang=lang, time_ms=max(time_ms, 4000), memory_mb=memory_mb))
    assert report["compile"] is None or report["compile"]["ok"], report["compile"]
    for test in report["tests"]:
        assert test["outcome"] == "OK", test
        seen = dict(line.split("=", 1) for line in test["stdout"].split())
        assert seen == EXPECTED, (lang, test["id"], seen)
        assert TOKEN not in test["stdout"] + test["stderr"]
    assert no_containers_left()


@pytest.mark.parametrize("lang", LANGS)
def test_an_infinite_loop_hits_the_time_limit(lang):
    [test] = attack(lang, INFINITE_LOOP[lang], [""])["tests"]
    assert test["outcome"] == "TIME_LIMIT", test


@pytest.mark.parametrize("lang", LANGS)
def test_a_memory_bomb_is_stopped(lang):
    [test] = attack(lang, MEMORY_BOMB[lang], [""])["tests"]
    # The kernel's OOM kill is a memory-limit verdict; a runtime that catches it first (Java's
    # OutOfMemoryError, a failed allocation) is a crash. Never a pass, never a hang.
    assert test["outcome"] in ("MEMORY_LIMIT", "RUNTIME_ERROR"), test


@pytest.mark.parametrize("lang", LANGS)
def test_endless_output_hits_the_output_limit(lang):
    [test] = attack(lang, OUTPUT_FLOOD[lang], [""])["tests"]
    assert test["outcome"] == "OUTPUT_LIMIT", test
    assert len(test["stdout"].encode()) <= 65_536


@pytest.mark.parametrize("lang", LANGS)
def test_a_fork_or_thread_bomb_is_contained_and_the_runner_survives(lang):
    [test] = attack(lang, FORK_BOMB[lang], [""])["tests"]
    assert test["outcome"] in ("TIME_LIMIT", "RUNTIME_ERROR", "MEMORY_LIMIT"), test
    assert no_containers_left()
    # The next job runs normally.
    ok = run_job(job("print('still here')\n", [""])) if _have(PY) else None
    assert ok is None or ok["tests"][0]["stdout"].strip() == "still here"


@pytest.mark.parametrize("lang", [p for p in LANGS if p.values[0] in ("c", "cpp")])
def test_a_compile_time_bomb_is_stopped(lang):
    # The compiler would read an endless file: the compile time and memory limits end it.
    bomb = job('#include "/dev/zero"\nint main(void) { return 0; }\n', [""], lang=lang)
    bomb["compile_time_limit_ms"] = 5_000
    bomb["compile_memory_mb"] = 256
    report = run_job(bomb)
    assert report["compile"]["ok"] is False and report["tests"] == []
    assert no_containers_left()
