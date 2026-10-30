
#!/usr/bin/env python3
"""
DevScope - Standalone Project Inspection Toolkit
================================================

A dependency-free project scanner that inspects source-code
directories and generates structured project reports.

Features:
- Recursive directory scanning
- File-type and language detection
- File-size and line-count statistics
- TODO, FIXME, HACK and XXX discovery
- Empty-file detection
- Large-file detection
- Hidden-file and ignored-directory handling
- Duplicate file detection using SHA-256
- Project structure generation
- JSON and HTML report export
- Command-line interface

This module is independent of the main application.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional


VERSION = "1.0.0"

DEFAULT_IGNORED_DIRS = {
    ".git", ".hg", ".svn", ".idea", ".vscode",
    "__pycache__", ".pytest_cache", ".mypy_cache",
    ".next", ".nuxt", ".turbo", ".cache",
    "node_modules", "vendor", "dist", "build",
    "target", "coverage", ".venv", "venv",
    "env", ".tox", ".gradle", ".terraform",
    "Pods", "DerivedData", ".dart_tool",
}

DEFAULT_IGNORED_FILES = {
    ".DS_Store", "Thumbs.db", "desktop.ini",
}

LANGUAGE_MAP = {
    ".py": "Python",
    ".pyi": "Python",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".java": "Java",
    ".c": "C",
    ".h": "C/C++ Header",
    ".cpp": "C++",
    ".cc": "C++",
    ".hpp": "C++",
    ".cs": "C#",
    ".go": "Go",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".dart": "Dart",
    ".scala": "Scala",
    ".r": "R",
    ".R": "R",
    ".sql": "SQL",
    ".html": "HTML",
    ".htm": "HTML",
    ".css": "CSS",
    ".scss": "SCSS",
    ".sass": "Sass",
    ".less": "Less",
    ".json": "JSON",
    ".xml": "XML",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".ini": "INI",
    ".md": "Markdown",
    ".rst": "reStructuredText",
    ".txt": "Text",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".ps1": "PowerShell",
    ".bat": "Batch",
    ".cmd": "Batch",
    ".dockerfile": "Dockerfile",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".graphql": "GraphQL",
    ".gql": "GraphQL",
    ".proto": "Protocol Buffers",
    ".ipynb": "Jupyter Notebook",
}

CONFIG_FILES = {
    "package.json", "pyproject.toml", "requirements.txt",
    "requirements.lock", "Pipfile", "Pipfile.lock",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
    "composer.json", "Gemfile", "pubspec.yaml",
    "Dockerfile", "docker-compose.yml",
    ".env.example", ".gitignore", "Makefile",
}

MARKER_PATTERN = re.compile(
    r"\b(TODO|FIXME|HACK|XXX|BUG|NOTE)\b"
    r"\s*[:\-]?\s*(.*)",
    re.IGNORECASE,
)

SECRET_PATTERNS = [
    (
        "Possible API key",
        re.compile(
            r"""(?i)(?:api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}"""
        ),
    ),
    (
        "Possible private key",
        re.compile(
            r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
        ),
    ),
    (
        "Possible password assignment",
        re.compile(
            r"""(?i)(?:password|passwd|secret)\s*[:=]\s*['"][^'"]{6,}"""
        ),
    ),
]


@dataclass
class FileRecord:
    """Information collected about one scanned file."""

    path: str
    name: str
    extension: str
    language: str
    size_bytes: int
    lines: int = 0
    blank_lines: int = 0
    non_blank_lines: int = 0
    comment_lines: int = 0
    sha256: str = ""
    is_config: bool = False
    is_test: bool = False
    is_empty: bool = False
    read_error: Optional[str] = None


@dataclass
class MarkerRecord:
    """A discovered source-code marker."""

    path: str
    line: int
    marker: str
    message: str


@dataclass
class SecurityRecord:
    """A potential security concern discovered in source text."""

    path: str
    line: int
    category: str
    description: str


@dataclass
class ScanStatistics:
    """Aggregate scan statistics."""

    total_files: int = 0
    scanned_files: int = 0
    skipped_files: int = 0
    total_directories: int = 0
    total_bytes: int = 0
    total_lines: int = 0
    blank_lines: int = 0
    non_blank_lines: int = 0
    empty_files: int = 0
    test_files: int = 0
    config_files: int = 0
    errors: int = 0
    duration_seconds: float = 0.0


@dataclass
class ScanResult:
    """Complete result of a DevScope scan."""

    root: str
    generated_at: str
    version: str
    statistics: ScanStatistics
    files: list[FileRecord] = field(default_factory=list)
    markers: list[MarkerRecord] = field(default_factory=list)
    security_findings: list[SecurityRecord] = field(default_factory=list)
    languages: dict[str, int] = field(default_factory=dict)
    extensions: dict[str, int] = field(default_factory=dict)
    directory_summary: dict[str, int] = field(default_factory=dict)
    duplicate_groups: list[list[str]] = field(default_factory=list)
    project_tree: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class DevScopeError(Exception):
    """Base exception for DevScope."""


class ProjectScanner:
    """Recursively scans a project and builds a ScanResult."""

    def __init__(
        self,
        root: str | Path,
        ignored_dirs: Optional[Iterable[str]] = None,
        ignored_files: Optional[Iterable[str]] = None,
        max_file_size: int = 5 * 1024 * 1024,
        include_hidden: bool = False,
        follow_symlinks: bool = False,
    ) -> None:
        self.root = Path(root).expanduser().resolve()

        self.ignored_dirs = set(DEFAULT_IGNORED_DIRS)
        self.ignored_files = set(DEFAULT_IGNORED_FILES)

        if ignored_dirs:
            self.ignored_dirs.update(ignored_dirs)

        if ignored_files:
            self.ignored_files.update(ignored_files)

        self.max_file_size = max_file_size
        self.include_hidden = include_hidden
        self.follow_symlinks = follow_symlinks

        self.result = ScanResult(
            root=str(self.root),
            generated_at=datetime.now(timezone.utc).isoformat(),
            version=VERSION,
            statistics=ScanStatistics(),
        )

        self._language_counts = Counter()
        self._extension_counts = Counter()
        self._directory_counts = Counter()
        self._hash_groups = defaultdict(list)

    def scan(self) -> ScanResult:
        """Scan the configured project directory."""

        if not self.root.exists():
            raise DevScopeError(
                f"Project directory does not exist: {self.root}"
            )

        if not self.root.is_dir():
            raise DevScopeError(
                f"Expected a directory, received: {self.root}"
            )

        started = time.perf_counter()

        for current, directories, filenames in os.walk(
            self.root,
            followlinks=self.follow_symlinks,
        ):
            current_path = Path(current)

            directories[:] = sorted(
                directory
                for directory in directories
                if self._should_visit_directory(
                    current_path / directory
                )
            )

            self.result.statistics.total_directories += 1

            for filename in sorted(filenames):
                path = current_path / filename

                self.result.statistics.total_files += 1

                if not self._should_scan_file(path):
                    self.result.statistics.skipped_files += 1
                    continue

                try:
                    record = self._inspect_file(path)
                    self._record_file(record)
                except OSError as exc:
                    self.result.statistics.errors += 1
                    self.result.errors.append(
                        f"{self._relative(path)}: {exc}"
                    )

        self._finalize()
        self.result.statistics.duration_seconds = round(
            time.perf_counter() - started, 4
        )

        return self.result

    def _should_visit_directory(self, path: Path) -> bool:
        if path.name in self.ignored_dirs:
            return False

        if not self.include_hidden and path.name.startswith("."):
            return False

        if path.is_symlink() and not self.follow_symlinks:
            return False

        return True

    def _should_scan_file(self, path: Path) -> bool:
        if path.name in self.ignored_files:
            return False

        if not self.include_hidden and path.name.startswith("."):
            return False

        if path.is_symlink() and not self.follow_symlinks:
            return False

        try:
            if not path.is_file():
                return False

            if path.stat().st_size > self.max_file_size:
                return False
        except OSError:
            return False

        return True

    def _relative(self, path: Path) -> str:
        try:
            return path.relative_to(self.root).as_posix()
        except ValueError:
            return str(path)

    def _detect_language(self, path: Path) -> str:
        if path.name.lower() == "dockerfile":
            return "Dockerfile"

        if path.name.lower() == "makefile":
            return "Makefile"

        return LANGUAGE_MAP.get(
            path.suffix.lower(),
            "Other",
        )

    def _is_test_file(self, path: Path) -> bool:
        name = path.name.lower()

        return (
            name.startswith("test_")
            or name.endswith("_test.py")
            or ".test." in name
            or ".spec." in name
            or name.endswith("tests.py")
        )

    def _hash_file(self, path: Path) -> str:
        digest = hashlib.sha256()

        with path.open("rb") as file:
            for chunk in iter(
                lambda: file.read(65536),
                b"",
            ):
                digest.update(chunk)

        return digest.hexdigest()

    def _inspect_file(self, path: Path) -> FileRecord:
        relative = self._relative(path)
        extension = path.suffix.lower()
        language = self._detect_language(path)
        size = path.stat().st_size

        record = FileRecord(
            path=relative,
            name=path.name,
            extension=extension or "[no extension]",
            language=language,
            size_bytes=size,
            is_config=(
                path.name in CONFIG_FILES
                or path.name.lower() == "dockerfile"
            ),
            is_test=self._is_test_file(path),
            is_empty=size == 0,
        )

        if size == 0:
            record.sha256 = hashlib.sha256(b"").hexdigest()
            return record

        if language in {"Other", "Jupyter Notebook"}:
            record.sha256 = self._hash_file(path)
            return record

        try:
            content = path.read_text(
                encoding="utf-8",
                errors="replace",
            )
        except OSError as exc:
            record.read_error = str(exc)
            raise

        lines = content.splitlines()

        record.lines = len(lines)
        record.blank_lines = sum(
            1 for line in lines if not line.strip()
        )
        record.non_blank_lines = (
            record.lines - record.blank_lines
        )

        record.sha256 = self._hash_file(path)

        return record

    def _record_file(self, record: FileRecord) -> None:
        self.result.files.append(record)

        stats = self.result.statistics

        stats.scanned_files += 1
        stats.total_bytes += record.size_bytes
        stats.total_lines += record.lines
        stats.blank_lines += record.blank_lines
        stats.non_blank_lines += record.non_blank_lines

        if record.is_empty:
            stats.empty_files += 1

        if record.is_test:
            stats.test_files += 1

        if record.is_config:
            stats.config_files += 1

        self._language_counts[record.language] += 1
        self._extension_counts[record.extension] += 1

        directory = str(Path(record.path).parent)

        if directory == ".":
            directory = "[root]"

        self._directory_counts[directory] += 1
        self._hash_groups[record.sha256].append(record.path)

        absolute_path = self.root / record.path

        self._inspect_markers(absolute_path, record.path)
        self._inspect_security(absolute_path, record.path)

    def _inspect_markers(
        self,
        absolute_path: Path,
        relative_path: str,
    ) -> None:
        try:
            content = absolute_path.read_text(
                encoding="utf-8",
                errors="replace",
            )
        except OSError:
            return

        for number, line in enumerate(
            content.splitlines(),
            start=1,
        ):
            match = MARKER_PATTERN.search(line)

            if not match:
                continue

            self.result.markers.append(
                MarkerRecord(
                    path=relative_path,
                    line=number,
                    marker=match.group(1).upper(),
                    message=match.group(2).strip(),
                )
            )

    def _inspect_security(
        self,
        absolute_path: Path,
        relative_path: str,
    ) -> None:
        try:
            content = absolute_path.read_text(
                encoding="utf-8",
                errors="replace",
            )
        except OSError:
            return

        for number, line in enumerate(
            content.splitlines(),
            start=1,
        ):
            for category, pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    self.result.security_findings.append(
                        SecurityRecord(
                            path=relative_path,
                            line=number,
                            category=category,
                            description=(
                                "Potential sensitive value detected. "
                                "Review manually; this is not proof "
                                "of an exposed credential."
                            ),
                        )
                    )

    def _finalize(self) -> None:
        self.result.languages = dict(
            self._language_counts.most_common()
        )

        self.result.extensions = dict(
            self._extension_counts.most_common()
        )

        self.result.directory_summary = dict(
            self._directory_counts.most_common()
        )

        self.result.duplicate_groups = [
            paths
            for paths in self._hash_groups.values()
            if len(paths) > 1
        ]

        self.result.project_tree = self._build_tree()

    def _build_tree(self) -> list[str]:
        output = [self.root.name + "/"]

        directories = []
        files = []

        for record in self.result.files:
            path = Path(record.path)

            parent = path.parent

            while str(parent) != ".":
                directories.append(parent.as_posix() + "/")
                parent = parent.parent

            files.append(record.path)

        for item in sorted(set(directories)):
            depth = item.rstrip("/").count("/") + 1
            output.append(
                "    " * depth + Path(item.rstrip("/")).name + "/"
            )

        for item in sorted(set(files)):
            depth = len(Path(item).parts)
            output.append(
                "    " * depth + Path(item).name
            )

        return output


class ReportExporter:
    """Exports scan results into JSON and HTML formats."""

    @staticmethod
    def to_dict(result: ScanResult) -> dict[str, Any]:
        return asdict(result)

    @staticmethod
    def save_json(
        result: ScanResult,
        destination: str | Path,
    ) -> Path:
        destination = Path(destination)
        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        destination.write_text(
            json.dumps(
                ReportExporter.to_dict(result),
                indent=4,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        return destination

    @staticmethod
    def save_html(
        result: ScanResult,
        destination: str | Path,
    ) -> Path:
        destination = Path(destination)
        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        stats = result.statistics

        rows = []

        for record in result.files:
            rows.append(
                "<tr>"
                f"<td>{html.escape(record.path)}</td>"
                f"<td>{html.escape(record.language)}</td>"
                f"<td>{record.lines}</td>"
                f"<td>{record.size_bytes}</td>"
                "</tr>"
            )

        marker_rows = []

        for marker in result.markers:
            marker_rows.append(
                "<tr>"
                f"<td>{html.escape(marker.path)}</td>"
                f"<td>{marker.line}</td>"
                f"<td>{html.escape(marker.marker)}</td>"
                f"<td>{html.escape(marker.message)}</td>"
                "</tr>"
            )

        language_items = "".join(
            f"<li>{html.escape(name)}: {count}</li>"
            for name, count in result.languages.items()
        )

        document = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevScope Project Report</title>
<style>
body {{
    font-family: Arial, sans-serif;
    max-width: 1200px;
    margin: 35px auto;
    padding: 0 20px;
    background: #f5f7fa;
    color: #202938;
}}
header {{
    background: #172554;
    color: white;
    padding: 28px;
    border-radius: 12px;
}}
section {{
    background: white;
    padding: 22px;
    margin-top: 22px;
    border-radius: 10px;
    box-shadow: 0 2px 8px #0000000d;
}}
.grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
}}
.metric {{
    padding: 18px;
    background: #eff6ff;
    border-radius: 8px;
}}
.metric strong {{
    display: block;
    font-size: 25px;
    margin-bottom: 5px;
}}
table {{
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
}}
th, td {{
    padding: 10px;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
    overflow-wrap: anywhere;
}}
th {{
    background: #f1f5f9;
}}
footer {{
    margin-top: 25px;
    color: #64748b;
}}
</style>
</head>
<body>
<header>
<h1>DevScope</h1>
<p>Standalone Project Inspection Report</p>
<p>Project: {html.escape(result.root)}</p>
<p>Generated: {html.escape(result.generated_at)}</p>
</header>

<section>
<h2>Project Overview</h2>
<div class="grid">
<div class="metric"><strong>{stats.scanned_files}</strong>Scanned files</div>
<div class="metric"><strong>{stats.total_directories}</strong>Directories</div>
<div class="metric"><strong>{stats.total_lines}</strong>Lines</div>
<div class="metric"><strong>{stats.total_bytes}</strong>Bytes</div>
<div class="metric"><strong>{stats.test_files}</strong>Test files</div>
<div class="metric"><strong>{stats.empty_files}</strong>Empty files</div>
</div>
</section>

<section>
<h2>Language Distribution</h2>
<ul>{language_items}</ul>
</section>

<section>
<h2>Source Files</h2>
<table>
<thead><tr><th>File</th><th>Language</th>
<th>Lines</th><th>Bytes</th></tr></thead>
<tbody>{''.join(rows)}</tbody>
</table>
</section>

<section>
<h2>Code Markers</h2>
<table>
<thead><tr><th>File</th><th>Line</th>
<th>Marker</th><th>Message</th></tr></thead>
<tbody>{''.join(marker_rows)}</tbody>
</table>
</section>

<section>
<h2>Additional Findings</h2>
<p>Potential security patterns: {len(result.security_findings)}</p>
<p>Duplicate file groups: {len(result.duplicate_groups)}</p>
<p>Scan errors: {stats.errors}</p>
</section>

<footer>
Generated by DevScope v{VERSION}.
Findings are automated indicators and require human review.
</footer>
</body>
</html>
"""

        destination.write_text(
            document,
            encoding="utf-8",
        )

        return destination


class ConsoleReporter:
    """Displays readable scan summaries in the terminal."""

    @staticmethod
    def print_summary(result: ScanResult) -> None:
        stats = result.statistics

        print("\n" + "=" * 65)
        print("                         DEVSCOPE")
        print("              PROJECT INSPECTION SUMMARY")
        print("=" * 65)

        print(f"\nProject       : {result.root}")
        print(f"Generated     : {result.generated_at}")
        print(f"Version       : {result.version}")

        print("\nPROJECT STATISTICS")
        print("-" * 65)

        values = [
            ("Total files discovered", stats.total_files),
            ("Files scanned", stats.scanned_files),
            ("Files skipped", stats.skipped_files),
            ("Directories", stats.total_directories),
            ("Total lines", stats.total_lines),
            ("Blank lines", stats.blank_lines),
            ("Non-blank lines", stats.non_blank_lines),
            ("Total size", f"{stats.total_bytes:,} bytes"),
            ("Test files", stats.test_files),
            ("Configuration files", stats.config_files),
            ("Empty files", stats.empty_files),
            ("Scan errors", stats.errors),
        ]

        for label, value in values:
            print(f"{label:<30}: {value}")

        print("\nLANGUAGE DISTRIBUTION")
        print("-" * 65)

        if result.languages:
            for language, count in result.languages.items():
                print(f"{language:<25}: {count}")
        else:
            print("No recognized languages found.")

        print("\nCODE MARKERS")
        print("-" * 65)

        if result.markers:
            for marker in result.markers:
                print(
                    f"{marker.path}:{marker.line} "
                    f"[{marker.marker}] {marker.message}"
                )
        else:
            print("No markers found.")

        print("\nDUPLICATE FILE GROUPS")
        print("-" * 65)

        if result.duplicate_groups:
            for group in result.duplicate_groups:
                print(", ".join(group))
        else:
            print("No duplicate files detected.")

        print("\nPOTENTIAL SECURITY PATTERNS")
        print("-" * 65)

        if result.security_findings:
            for finding in result.security_findings:
                print(
                    f"{finding.path}:{finding.line} "
                    f"- {finding.category}"
                )
        else:
            print("No matching patterns found.")

        print("\n" + "=" * 65)
        print(
            f"Completed in {stats.duration_seconds:.4f} seconds"
        )
        print("=" * 65)


def build_argument_parser() -> argparse.ArgumentParser:
    """Create the command-line argument parser."""

    parser = argparse.ArgumentParser(
        prog="devscope",
        description=(
            "Inspect source-code projects and generate reports."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Project directory to inspect",
    )

    parser.add_argument(
        "--json",
        dest="json_output",
        help="Save JSON report to the specified path",
    )

    parser.add_argument(
        "--html",
        dest="html_output",
        help="Save HTML report to the specified path",
    )

    parser.add_argument(
        "--max-size",
        type=int,
        default=5 * 1024 * 1024,
        help="Maximum file size to inspect in bytes",
    )

    parser.add_argument(
        "--ignore-dir",
        action="append",
        default=[],
        help="Additional directory name to ignore",
    )

    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include hidden files and directories",
    )

    parser.add_argument(
        "--follow-symlinks",
        action="store_true",
        help="Follow symbolic links during scanning",
    )

    parser.add_argument(
        "--tree",
        action="store_true",
        help="Print the project file tree",
    )

    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress the console summary",
    )

    parser.add_argument(
        "--version",
        action="version",
        version=f"DevScope {VERSION}",
    )

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    """Application entry point."""

    parser = build_argument_parser()
    args = parser.parse_args(argv)

    if args.max_size <= 0:
        parser.error("--max-size must be greater than zero")

    try:
        scanner = ProjectScanner(
            root=args.directory,
            ignored_dirs=args.ignore_dir,
            max_file_size=args.max_size,
            include_hidden=args.include_hidden,
            follow_symlinks=args.follow_symlinks,
        )

        result = scanner.scan()

        if not args.quiet:
            ConsoleReporter.print_summary(result)

        if args.tree:
            print("\nPROJECT TREE")
            print("-" * 65)

            for item in result.project_tree:
                print(item)

        if args.json_output:
            output = ReportExporter.save_json(
                result,
                args.json_output,
            )
            print(f"\nJSON report saved: {output}")

        if args.html_output:
            output = ReportExporter.save_html(
                result,
                args.html_output,
            )
            print(f"HTML report saved: {output}")

        return 0

    except (DevScopeError, OSError) as exc:
        print(f"DevScope error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
