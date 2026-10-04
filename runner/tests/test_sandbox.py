"""The runner's sandbox, against real Docker (skipped when Docker or an image is missing).

What is asserted, per language where it matters:
* correct programs exit cleanly with their output (the API, not the runner, judges correctness);
* a crash is a runtime error and a compile failure is reported with the compiler's message;
* an infinite loop hits the time limit, a memory bomb the memory limit, endless output the output limit;
* a fork bomb is contained (the process limit) and the runner survives it;
* there is no network: connecting anywhere fails;
* the code folder and the system are read-only, and nothing written survives into the next test;
* the runner's own environment (its token) never reaches the program.
"""

import os
import shutil
import subprocess

import pytest

from assessx_runner.sandbox import SandboxConfig, run_job, sweep

PY = "python:3.12-slim"
GCC = "gcc:14"
JAVA = "eclipse-temurin:21-jdk"


def _have(image: str) -> bool:
    if not shutil.which("docker"):
        return False
    probe = subprocess.run(["docker", "image", "inspect", image], capture_output=True, check=False)
    return probe.returncode == 0


needs_python = pytest.mark.skipif(not _have(PY), reason=f"{PY} not available")
needs_gcc = pytest.mark.skipif(not _have(GCC), reason=f"{GCC} not available")
needs_java = pytest.mark.skipif(not _have(JAVA), reason=f"{JAVA} not available")


def job(source: str, tests: list[str], *, lang: str = "python", time_ms: int = 2000, memory_mb: int = 128) -> dict:
    spec = {
        "python": (PY, "main.py", None, ["python3", "-I", "main.py"]),
        "c": (GCC, "main.c", ["gcc", "-O2", "-std=c17", "-o", "main", "main.c", "-lm"], ["./main"]),
        "cpp": (GCC, "main.cpp", ["g++", "-O2", "-std=c++20", "-o", "main", "main.cpp"], ["./main"]),
        "java": (JAVA, "Main.java", ["javac", "-encoding", "UTF-8", "Main.java"], ["java", "-XX:+UseSerialGC", "-XX:-UsePerfData", "-Xss64m", "Main"]),
    }[lang]
    return {
        "id": "test",
        "language": lang,
        "image": spec[0],
        "source_file": spec[1],
        "compile": spec[2],
        "run": spec[3],
        "source": source,
        "time_limit_ms": time_ms,
        "memory_limit_mb": memory_mb,
        "compile_time_limit_ms": 60_000,
        "compile_memory_mb": 1024,
        "output_limit_bytes": 65_536,
        "tests": [{"id": str(i), "input": data} for i, data in enumerate(tests)],
    }


def outcomes(report: dict) -> list[str]:
    return [t["outcome"] for t in report["tests"]]


@pytest.fixture(autouse=True, scope="module")
def _clean():
    yield
    if shutil.which("docker"):
        sweep(SandboxConfig())


# -- Python ------------------------------------------------------------------------------------------------


@needs_python
def test_python_runs_each_test_with_its_own_input():
    report = run_job(job("a, b = map(int, input().split())\nprint(a + b)\n", ["1 2\n", "40 2\n"]))
    assert outcomes(report) == ["OK", "OK"]
    assert [t["stdout"] for t in report["tests"]] == ["3\n", "42\n"]
    assert report["compile"] is None


@needs_python
def test_a_crash_is_a_runtime_error_with_its_message():
    report = run_job(job("raise ValueError('boom')\n", [""]))
    assert outcomes(report) == ["RUNTIME_ERROR"]
    assert "ValueError: boom" in report["tests"][0]["stderr"]


@needs_python
def test_an_infinite_loop_hits_the_time_limit():
    report = run_job(job("while True:\n    pass\n", [""], time_ms=1000))
    assert outcomes(report) == ["TIME_LIMIT"]
    assert report["tests"][0]["runtime_ms"] <= 1000


@needs_python
def test_a_memory_bomb_hits_the_memory_limit():
    report = run_job(job("x = bytearray(512 * 1024 * 1024)\nprint(len(x))\n", [""], memory_mb=64))
    assert outcomes(report) == ["MEMORY_LIMIT"]


@needs_python
def test_endless_output_hits_the_output_limit():
    report = run_job(job("while True:\n    print('x' * 1000)\n", [""], time_ms=5000))
    assert outcomes(report) == ["OUTPUT_LIMIT"]
    assert len(report["tests"][0]["stdout"]) <= 65_536


@needs_python
def test_a_fork_bomb_is_contained():
    source = "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass\n"
    report = run_job(job(source, [""], time_ms=2000))
    assert outcomes(report)[0] in ("TIME_LIMIT", "RUNTIME_ERROR", "MEMORY_LIMIT")
    # The runner (and Docker) are still fine afterwards.
    assert outcomes(run_job(job("print('alive')\n", [""]))) == ["OK"]


@needs_python
def test_there_is_no_network():
    source = (
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('1.1.1.1', 53), timeout=2)\n"
        "    print('CONNECTED')\n"
        "except OSError:\n"
        "    print('blocked')\n"
    )
    report = run_job(job(source, [""], time_ms=5000))
    assert report["tests"][0]["stdout"].strip() == "blocked"


@needs_python
def test_the_filesystem_is_read_only_and_nothing_survives_into_the_next_test():
    source = (
        "import os, sys\n"
        "data = sys.stdin.read().strip()\n"
        "results = []\n"
        "for path in ('/work/stolen.txt', '/etc/stolen.txt', '/stolen.txt'):\n"
        "    try:\n"
        "        open(path, 'w').write(data)\n"
        "        results.append('wrote ' + path)\n"
        "    except OSError:\n"
        "        results.append('denied')\n"
        "previous = open('/tmp/carry').read() if os.path.exists('/tmp/carry') else 'nothing'\n"
        "open('/tmp/carry', 'w').write(data)\n"
        "print(' '.join(results), previous)\n"
    )
    report = run_job(job(source, ["SECRET-HIDDEN-INPUT\n", "second\n"]))
    first, second = (t["stdout"].strip() for t in report["tests"])
    assert first == "denied denied denied nothing"
    assert second == "denied denied denied nothing"  # the first test's /tmp did not survive


@needs_python
def test_the_runners_environment_never_reaches_the_program(monkeypatch):
    monkeypatch.setenv("RUNNER_TOKEN", "super-secret-runner-token")
    report = run_job(job("import os\nprint(sorted(os.environ))\nprint(os.environ.get('RUNNER_TOKEN'))\n", [""]))
    output = report["tests"][0]["stdout"]
    assert "super-secret-runner-token" not in output and "RUNNER_TOKEN" not in output
    assert output.strip().endswith("None")


@needs_python
def test_the_program_runs_as_an_unprivileged_user():
    report = run_job(job("import os\nprint(os.getuid(), os.getgid())\n", [""]))
    assert report["tests"][0]["stdout"].strip() == "65534 65534"


@needs_python
def test_nothing_is_left_behind():
    run_job(job("print(1)\n", ["", ""]))
    left = subprocess.run(["docker", "ps", "-aq", "--filter", "label=assessx-runner=1"], capture_output=True, text=True, check=False)
    assert left.stdout.strip() == ""


# -- compiled languages ------------------------------------------------------------------------------------


@needs_gcc
def test_c_compiles_and_runs():
    source = '#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}\n'
    report = run_job(job(source, ["2 3\n"], lang="c"))
    assert report["compile"]["ok"] is True and outcomes(report) == ["OK"] and report["tests"][0]["stdout"] == "5\n"


@needs_gcc
def test_a_c_compile_error_is_reported_with_the_compilers_message():
    report = run_job(job("int main(void) { return x; }\n", ["\n"], lang="c"))
    assert report["compile"]["ok"] is False and "x" in report["compile"]["output"] and report["tests"] == []


@needs_gcc
def test_cpp_compiles_runs_and_a_segfault_is_a_runtime_error():
    ok = run_job(job("#include <bits/stdc++.h>\nint main(){long long n;std::cin>>n;std::cout<<n*n<<\"\\n\";}\n", ["12\n"], lang="cpp"))
    assert outcomes(ok) == ["OK"] and ok["tests"][0]["stdout"] == "144\n"
    crash = run_job(job("int main(){int *p=nullptr; return *p;}\n", [""], lang="cpp"))
    assert outcomes(crash) == ["RUNTIME_ERROR"]


@needs_java
def test_java_compiles_and_runs():
    source = (
        "import java.util.*;\n"
        "public class Main { public static void main(String[] a) { Scanner s = new Scanner(System.in);"
        " System.out.println(s.nextInt() + s.nextInt()); } }\n"
    )
    report = run_job(job(source, ["4 5\n"], lang="java", time_ms=6000, memory_mb=384))
    assert report["compile"]["ok"] is True and outcomes(report) == ["OK"] and report["tests"][0]["stdout"] == "9\n"


@needs_java
def test_a_java_infinite_loop_hits_the_time_limit():
    source = "public class Main { public static void main(String[] a) { while (true) {} } }\n"
    report = run_job(job(source, [""], lang="java", time_ms=1500, memory_mb=384))
    assert outcomes(report) == ["TIME_LIMIT"]


if os.name == "nt":  # pragma: no cover - documentation for Windows hosts
    pass
