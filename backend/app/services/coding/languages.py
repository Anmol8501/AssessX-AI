"""The coding-language registry: everything language-specific lives here and nowhere else.

The API uses it to validate a problem's languages and to offer starter templates. The runner (stage C2)
uses the same entries to pick a container image and the compile and run commands. Candidates can only
choose a language the administrator enabled on the problem, and the server checks every choice against
this registry, never trusting the client.

Images are free, official Docker Hub images. Adding a language means adding an entry here (and its image
on the runner host).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    id: str
    name: str
    version: str
    extension: str
    #: The file the candidate's source is written to inside the sandbox.
    source_file: str
    #: Container image on the runner host (free, official).
    image: str
    #: Compile step (None for interpreted languages), then the run step. Plain argv, never a shell.
    compile: tuple[str, ...] | None
    run: tuple[str, ...]
    #: Multiplies the problem's time limit (slower runtimes get more wall-clock time).
    time_factor: float
    #: Added to the problem's memory limit (e.g. the JVM's own footprint).
    memory_extra_mb: int
    starter: str


LANGUAGES: dict[str, Language] = {
    lang.id: lang
    for lang in (
        Language(
            id="python",
            name="Python",
            version="3.12",
            extension="py",
            source_file="main.py",
            image="python:3.12-slim",
            compile=None,
            run=("python3", "-I", "main.py"),
            time_factor=2.0,
            memory_extra_mb=0,
            starter='def solve():\n    pass\n\n\nif __name__ == "__main__":\n    solve()\n',
        ),
        Language(
            id="c",
            name="C",
            version="GCC 14 (C17)",
            extension="c",
            source_file="main.c",
            image="gcc:14",
            compile=("gcc", "-O2", "-std=c17", "-o", "main", "main.c", "-lm"),
            run=("./main",),
            time_factor=1.0,
            memory_extra_mb=0,
            starter="#include <stdio.h>\n\nint main(void) {\n    return 0;\n}\n",
        ),
        Language(
            id="cpp",
            name="C++",
            version="GCC 14 (C++20)",
            extension="cpp",
            source_file="main.cpp",
            image="gcc:14",
            compile=("g++", "-O2", "-std=c++20", "-o", "main", "main.cpp"),
            run=("./main",),
            time_factor=1.0,
            memory_extra_mb=0,
            starter="#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n",
        ),
        Language(
            id="java",
            name="Java",
            version="21",
            extension="java",
            source_file="Main.java",
            image="eclipse-temurin:21-jdk",
            compile=("javac", "-encoding", "UTF-8", "Main.java"),
            run=("java", "-XX:+UseSerialGC", "-XX:-UsePerfData", "-Xss64m", "Main"),
            time_factor=2.0,
            memory_extra_mb=128,
            starter="public class Main {\n    public static void main(String[] args) {\n    }\n}\n",
        ),
    )
}


def get_language(language_id: str) -> Language | None:
    return LANGUAGES.get(language_id)


def is_supported(language_id: str) -> bool:
    return language_id in LANGUAGES
