
"""
DevScope Advanced Analyzers
===========================

Standalone source-code analysis engine.

Features:
- Function and class extraction
- Cyclomatic complexity estimation
- Maintainability indicators
- Code smell detection
- Duplicate code block detection
- Import and dependency extraction
- Security-pattern inspection
- Naming convention checks
- Long function and long line detection
- TODO/FIXME analysis
- Documentation coverage estimation
- Quality scoring
- Structured analysis reports

All analysis is heuristic-based. Results should be
reviewed by a developer before making decisions.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional


SUPPORTED_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx",
    ".java", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".go", ".rs", ".rb", ".php",
    ".swift", ".kt", ".dart", ".scala",
}

LANGUAGE_BY_EXTENSION = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "javascript",
    ".tsx": "javascript",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".dart": "dart",
    ".scala": "scala",
}

COMPLEXITY_KEYWORDS = {
    "if", "elif", "for", "while", "except",
    "case", "catch", "switch",
}

SECURITY_RULES = [
    {
        "id": "SEC001",
        "name": "Dynamic code execution",
        "pattern": re.compile(
            r"\b(eval|exec)\s*\(",
        ),
        "severity": "high",
        "description": "Dynamic execution requires careful validation.",
    },
    {
        "id": "SEC002",
        "name": "Shell command execution",
        "pattern": re.compile(
            r"\b(os\.system|subprocess\.Popen|"
            r"subprocess\.call|child_process\.exec)\s*\(",
        ),
        "severity": "medium",
        "description": "Review command construction and input handling.",
    },
    {
        "id": "SEC003",
        "name": "Insecure HTTP connection",
        "pattern": re.compile(
            r"""http://[A-Za-z0-9._:/?=&%-]+"""
        ),
        "severity": "low",
        "description": "Check whether HTTPS should be used.",
    },
    {
        "id": "SEC004",
        "name": "Disabled certificate verification",
        "pattern": re.compile(
            r"verify\s*=\s*False|rejectUnauthorized\s*:\s*false",
            re.IGNORECASE,
        ),
        "severity": "high",
        "description": "Certificate verification appears disabled.",
    },
    {
        "id": "SEC005",
        "name": "Hardcoded credential assignment",
        "pattern": re.compile(
            r"""(?i)(?:password|passwd|secret|api_key)\s*[:=]\s*['"][^'"]+['"]"""
        ),
        "severity": "high",
        "description": "Review possible hardcoded credentials.",
    },
    {
        "id": "SEC006",
        "name": "SQL string construction",
        "pattern": re.compile(
            r"""(?i)(?:execute|executemany)\s*\(\s*['"].*(?:SELECT|INSERT|UPDATE|DELETE)"""
        ),
        "severity": "medium",
        "description": "Check whether parameterized SQL is used.",
    },
    {
        "id": "SEC007",
        "name": "Unsafe deserialization",
        "pattern": re.compile(
            r"\bpickle\.loads?\s*\(|\byaml\.load\s*\("
        ),
        "severity": "high",
        "description": "Review the trustworthiness of deserialized data.",
    },
    {
        "id": "SEC008",
        "name": "Debug mode enabled",
        "pattern": re.compile(
            r"\bDEBUG\s*=\s*True|debug\s*:\s*true",
            re.IGNORECASE,
        ),
        "severity": "low",
        "description": "Confirm debug mode is not enabled in production.",
    },
]

MARKER_PATTERN = re.compile(
    r"\b(TODO|FIXME|HACK|XXX|BUG|NOTE)\b"
    r"\s*[:\-]?\s*(.*)",
    re.IGNORECASE,
)

FUNCTION_PATTERNS = {
    "javascript": re.compile(
        r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\("
        r"|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
    ),
    "java": re.compile(
        r"\b(?:public|private|protected|static|final|"
        r"synchronized|abstract|\s)+"
        r"[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{"
    ),
    "c": re.compile(
        r"\b[\w*]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{"
    ),
    "cpp": re.compile(
        r"\b[\w:*&<>]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{"
    ),
    "csharp": re.compile(
        r"\b(?:public|private|protected|internal|static|"
        r"async|virtual|override|\s)+"
        r"[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{"
    ),
    "go": re.compile(
        r"\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\("
    ),
    "rust": re.compile(
        r"\bfn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\("
    ),
    "ruby": re.compile(
        r"^\s*def\s+([A-Za-z_]\w*[!?=]?)",
        re.MULTILINE,
    ),
    "php": re.compile(
        r"\bfunction\s+([A-Za-z_]\w*)\s*\("
    ),
    "swift": re.compile(
        r"\bfunc\s+([A-Za-z_]\w*)\s*\("
    ),
    "kotlin": re.compile(
        r"\bfun\s+([A-Za-z_]\w*)\s*\("
    ),
    "dart": re.compile(
        r"^\s*(?:Future<[^>]+>|[\w<>?]+)\s+"
        r"([A-Za-z_]\w*)\s*\(",
        re.MULTILINE,
    ),
    "scala": re.compile(
        r"\bdef\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\("
    ),
}

CLASS_PATTERNS = {
    "javascript": re.compile(
        r"\bclass\s+([A-Za-z_$][\w$]*)"
    ),
    "java": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "python": re.compile(
        r"^\s*class\s+([A-Za-z_]\w*)",
        re.MULTILINE,
    ),
    "csharp": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "cpp": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "ruby": re.compile(
        r"^\s*class\s+([A-Za-z_]\w*)",
        re.MULTILINE,
    ),
    "php": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "kotlin": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "dart": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "swift": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
    "scala": re.compile(
        r"\bclass\s+([A-Za-z_]\w*)"
    ),
}


@dataclass
class FunctionInfo:
    name: str
    file: str
    start_line: int
    end_line: int
    line_count: int
    complexity: int
    parameters: int = 0
    documented: bool = False
    language: str = "unknown"


@dataclass
class ClassInfo:
    name: str
    file: str
    start_line: int
    methods: int = 0
    language: str = "unknown"


@dataclass
class CodeIssue:
    rule_id: str
    category: str
    severity: str
    message: str
    file: str
    line: int = 0
    suggestion: str = ""


@dataclass
class DependencyInfo:
    source_file: str
    dependency: str
    dependency_type: str
    line: int = 0


@dataclass
class FileAnalysis:
    path: str
    language: str
    lines: int
    functions: int = 0
    classes: int = 0
    average_complexity: float = 0.0
    maximum_complexity: int = 0
    comment_lines: int = 0
    documentation_coverage: float = 0.0
    issues: list[CodeIssue] = field(default_factory=list)


@dataclass
class AnalysisReport:
    root: str
    files_analyzed: int
    total_functions: int
    total_classes: int
    average_complexity: float
    maximum_complexity: int
    documentation_coverage: float
    issues: list[CodeIssue] = field(default_factory=list)
    functions: list[FunctionInfo] = field(default_factory=list)
    classes: list[ClassInfo] = field(default_factory=list)
    dependencies: list[DependencyInfo] = field(default_factory=list)
    file_analyses: list[FileAnalysis] = field(default_factory=list)
    quality_score: float = 0.0
    quality_grade: str = "N/A"


def _language(path: Path) -> str:
    return LANGUAGE_BY_EXTENSION.get(
        path.suffix.lower(),
        "unknown",
    )


def _count_parameters(text: str) -> int:
    text = text.strip()

    if not text:
        return 0

    return len([
        item
        for item in text.split(",")
        if item.strip()
    ])


def _line_count(text: str) -> int:
    return len(text.splitlines())


def _complexity(text: str, language: str) -> int:
    """
    Estimate cyclomatic complexity using branching keywords.

    This is a lightweight heuristic, not a full parser.
    """

    complexity = 1

    patterns = [
        r"\bif\b",
        r"\belif\b",
        r"\bfor\b",
        r"\bwhile\b",
        r"\bexcept\b",
        r"\bcatch\b",
        r"\bcase\b",
        r"\b&&\b",
        r"\|\|",
        r"\band\b",
        r"\bor\b",
        r"\?",
    ]

    if language == "python":
        patterns.extend([
            r"\bassert\b",
            r"\bexcept\s+\w+",
        ])

    for pattern in patterns:
        complexity += len(re.findall(pattern, text))

    return complexity


def _find_function_matches(
    text: str,
    language: str,
) -> list[tuple[str, int]]:
    pattern = FUNCTION_PATTERNS.get(language)

    if not pattern:
        return []

    results = []

    for match in pattern.finditer(text):
        name = next(
            (
                group
                for group in match.groups()
                if group is not None
            ),
            None,
        )

        if name:
            line = text.count("\n", 0, match.start()) + 1
            results.append((name, line))

    return results


def _find_class_matches(
    text: str,
    language: str,
) -> list[tuple[str, int]]:
    pattern = CLASS_PATTERNS.get(language)

    if not pattern:
        return []

    return [
        (
            match.group(1),
            text.count("\n", 0, match.start()) + 1,
        )
        for match in pattern.finditer(text)
    ]


def _extract_python_functions(
    text: str,
    filename: str,
) -> list[FunctionInfo]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []

    lines = text.splitlines()
    results = []

    for node in ast.walk(tree):
        if not isinstance(
            node,
            (ast.FunctionDef, ast.AsyncFunctionDef),
        ):
            continue

        start = node.lineno
        end = getattr(node, "end_lineno", start)

        source = "\n".join(lines[start - 1:end])

        parameters = (
            len(node.args.posonlyargs)
            + len(node.args.args)
            + len(node.args.kwonlyargs)
        )

        if node.args.vararg:
            parameters += 1

        if node.args.kwarg:
            parameters += 1

        documented = bool(ast.get_docstring(node))

        results.append(
            FunctionInfo(
                name=node.name,
                file=filename,
                start_line=start,
                end_line=end,
                line_count=end - start + 1,
                complexity=_python_complexity(node),
                parameters=parameters,
                documented=documented,
                language="python",
            )
        )

    return results


def _python_complexity(node: ast.AST) -> int:
    complexity = 1

    for child in ast.walk(node):
        if isinstance(
            child,
            (
                ast.If,
                ast.For,
                ast.AsyncFor,
                ast.While,
                ast.ExceptHandler,
                ast.IfExp,
            ),
        ):
            complexity += 1

        elif isinstance(child, ast.BoolOp):
            complexity += max(
                0,
                len(child.values) - 1,
            )

        elif isinstance(child, ast.comprehension):
            complexity += 1

    return complexity


def _extract_python_classes(
    text: str,
    filename: str,
) -> list[ClassInfo]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []

    results = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        methods = sum(
            1
            for item in node.body
            if isinstance(
                item,
                (
                    ast.FunctionDef,
                    ast.AsyncFunctionDef,
                ),
            )
        )

        results.append(
            ClassInfo(
                name=node.name,
                file=filename,
                start_line=node.lineno,
                methods=methods,
                language="python",
            )
        )

    return results


def _extract_python_imports(
    text: str,
    filename: str,
) -> list[DependencyInfo]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []

    dependencies = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                dependencies.append(
                    DependencyInfo(
                        source_file=filename,
                        dependency=alias.name,
                        dependency_type="import",
                        line=node.lineno,
                    )
                )

        elif isinstance(node, ast.ImportFrom):
            dependencies.append(
                DependencyInfo(
                    source_file=filename,
                    dependency=node.module or ".",
                    dependency_type="from-import",
                    line=node.lineno,
                )
            )

    return dependencies


def _extract_generic_imports(
    text: str,
    filename: str,
    language: str,
) -> list[DependencyInfo]:
    dependencies = []

    patterns = {
        "javascript": [
            re.compile(
                r"""(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)"""
            ),
        ],
        "java": [
            re.compile(r"\bimport\s+([\w.]+)\s*;"),
        ],
        "go": [
            re.compile(r'\bimport\s+"([^"]+)"'),
        ],
        "rust": [
            re.compile(r"\buse\s+([\w:]+)"),
        ],
        "ruby": [
            re.compile(r"""require\s+['"]([^'"]+)['"]"""),
        ],
        "php": [
            re.compile(r"\buse\s+([\w\\]+)"),
        ],
        "c": [
            re.compile(r"#include\s+[<\"]([^>\"]+)[>\"]"),
        ],
        "cpp": [
            re.compile(r"#include\s+[<\"]([^>\"]+)[>\"]"),
        ],
        "csharp": [
            re.compile(r"\busing\s+([\w.]+)\s*;"),
        ],
    }

    for pattern in patterns.get(language, []):
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1

            dependencies.append(
                DependencyInfo(
                    source_file=filename,
                    dependency=match.group(1),
                    dependency_type="import",
                    line=line,
                )
            )

    return dependencies


class ComplexityAnalyzer:
    """Analyzes function complexity and size."""

    def __init__(
        self,
        warning_threshold: int = 10,
        critical_threshold: int = 20,
        max_function_lines: int = 50,
    ) -> None:
        self.warning_threshold = warning_threshold
        self.critical_threshold = critical_threshold
        self.max_function_lines = max_function_lines

    def analyze(
        self,
        functions: Iterable[FunctionInfo],
    ) -> list[CodeIssue]:
        issues = []

        for function in functions:
            if function.complexity >= self.critical_threshold:
                severity = "high"
            elif function.complexity >= self.warning_threshold:
                severity = "medium"
            else:
                severity = None

            if severity:
                issues.append(
                    CodeIssue(
                        rule_id="COMPLEX001",
                        category="complexity",
                        severity=severity,
                        message=(
                            f"Function '{function.name}' has "
                            f"estimated complexity "
                            f"{function.complexity}."
                        ),
                        file=function.file,
                        line=function.start_line,
                        suggestion=(
                            "Consider extracting smaller functions "
                            "and reducing nested branches."
                        ),
                    )
                )

            if function.line_count > self.max_function_lines:
                issues.append(
                    CodeIssue(
                        rule_id="SIZE001",
                        category="maintainability",
                        severity="medium",
                        message=(
                            f"Function '{function.name}' contains "
                            f"{function.line_count} lines."
                        ),
                        file=function.file,
                        line=function.start_line,
                        suggestion=(
                            "Consider splitting this function "
                            "into smaller responsibilities."
                        ),
                    )
                )

            if function.parameters > 7:
                issues.append(
                    CodeIssue(
                        rule_id="DESIGN001",
                        category="design",
                        severity="low",
                        message=(
                            f"Function '{function.name}' has "
                            f"{function.parameters} parameters."
                        ),
                        file=function.file,
                        line=function.start_line,
                        suggestion=(
                            "Consider grouping related parameters "
                            "into a configuration object."
                        ),
                    )
                )

        return issues


class SecurityAnalyzer:
    """Searches source text for potentially risky patterns."""

    def analyze(
        self,
        text: str,
        filename: str,
    ) -> list[CodeIssue]:
        issues = []

        for line_number, line in enumerate(
            text.splitlines(),
            start=1,
        ):
            for rule in SECURITY_RULES:
                if rule["pattern"].search(line):
                    issues.append(
                        CodeIssue(
                            rule_id=rule["id"],
                            category="security",
                            severity=rule["severity"],
                            message=rule["name"],
                            file=filename,
                            line=line_number,
                            suggestion=rule["description"],
                        )
                    )

        return issues


class CodeSmellAnalyzer:
    """Detects common maintainability and style concerns."""

    def __init__(
        self,
        max_line_length: int = 120,
        max_file_lines: int = 500,
    ) -> None:
        self.max_line_length = max_line_length
        self.max_file_lines = max_file_lines

    def analyze(
        self,
        text: str,
        filename: str,
        language: str,
    ) -> list[CodeIssue]:
        issues = []
        lines = text.splitlines()

        if len(lines) > self.max_file_lines:
            issues.append(
                CodeIssue(
                    rule_id="SIZE002",
                    category="maintainability",
                    severity="medium",
                    message=(
                        f"File contains {len(lines)} lines."
                    ),
                    file=filename,
                    suggestion=(
                        "Consider separating unrelated "
                        "responsibilities into modules."
                    ),
                )
            )

        for number, line in enumerate(lines, start=1):
            if len(line) > self.max_line_length:
                issues.append(
                    CodeIssue(
                        rule_id="STYLE001",
                        category="style",
                        severity="low",
                        message=(
                            f"Line exceeds {self.max_line_length} "
                            f"characters ({len(line)} found)."
                        ),
                        file=filename,
                        line=number,
                        suggestion=(
                            "Wrap the line or extract a "
                            "meaningful expression."
                        ),
                    )
                )

            if "\t" in line and language == "python":
                issues.append(
                    CodeIssue(
                        rule_id="STYLE002",
                        category="style",
                        severity="low",
                        message="Tab character detected.",
                        file=filename,
                        line=number,
                        suggestion=(
                            "Use consistent indentation."
                        ),
                    )
                )

            if line.rstrip() != line:
                issues.append(
                    CodeIssue(
                        rule_id="STYLE003",
                        category="style",
                        severity="low",
                        message="Trailing whitespace detected.",
                        file=filename,
                        line=number,
                        suggestion="Remove trailing whitespace.",
                    )
                )

        return issues


class NamingAnalyzer:
    """Checks common identifier naming conventions."""

    def analyze(
        self,
        text: str,
        filename: str,
        language: str,
    ) -> list[CodeIssue]:
        issues = []

        if language == "python":
            pattern = re.compile(
                r"^\s*def\s+([A-Za-z_]\w*)\s*\(",
                re.MULTILINE,
            )

            for match in pattern.finditer(text):
                name = match.group(1)

                if name.startswith("__") and name.endswith("__"):
                    continue

                if not re.fullmatch(
                    r"[a-z_][a-z0-9_]*",
                    name,
                ):
                    issues.append(
                        CodeIssue(
                            rule_id="NAME001",
                            category="naming",
                            severity="low",
                            message=(
                                f"Function '{name}' does not "
                                "follow snake_case."
                            ),
                            file=filename,
                            line=text.count(
                                "\n", 0, match.start()
                            ) + 1,
                            suggestion=(
                                "Use lowercase words separated "
                                "by underscores."
                            ),
                        )
                    )

        return issues


class DocumentationAnalyzer:
    """Estimates documentation coverage."""

    def analyze(
        self,
        text: str,
        filename: str,
        language: str,
        functions: list[FunctionInfo],
    ) -> tuple[float, list[CodeIssue]]:
        if not functions:
            return 100.0, []

        documented = sum(
            1 for function in functions
            if function.documented
        )

        coverage = round(
            documented / len(functions) * 100,
            2,
        )

        issues = []

        for function in functions:
            if not function.documented:
                issues.append(
                    CodeIssue(
                        rule_id="DOC001",
                        category="documentation",
                        severity="low",
                        message=(
                            f"Function '{function.name}' "
                            "has no detected documentation."
                        ),
                        file=filename,
                        line=function.start_line,
                        suggestion=(
                            "Add a short docstring or "
                            "function documentation."
                        ),
                    )
                )

        return coverage, issues


class DuplicateCodeAnalyzer:
    """Finds repeated normalized source-code blocks."""

    def __init__(
        self,
        minimum_lines: int = 5,
    ) -> None:
        self.minimum_lines = minimum_lines

    @staticmethod
    def _normalize(line: str) -> str:
        line = line.strip()

        if not line:
            return ""

        return re.sub(r"\s+", " ", line)

    def analyze(
        self,
        source_files: dict[str, str],
    ) -> list[CodeIssue]:
        issues = []
        block_locations = defaultdict(list)

        for filename, content in source_files.items():
            lines = [
                self._normalize(line)
                for line in content.splitlines()
            ]

            for index in range(
                max(0, len(lines) - self.minimum_lines + 1)
            ):
                block = lines[
                    index:index + self.minimum_lines
                ]

                if any(not line for line in block):
                    continue

                normalized = "\n".join(block)

                digest = hashlib.sha256(
                    normalized.encode("utf-8")
                ).hexdigest()

                block_locations[digest].append(
                    (filename, index + 1)
                )

        for locations in block_locations.values():
            unique_files = {
                filename
                for filename, _ in locations
            }

            if len(unique_files) < 2:
                continue

            for filename, line in locations:
                issues.append(
                    CodeIssue(
                        rule_id="DUP001",
                        category="duplication",
                        severity="low",
                        message=(
                            "Repeated source-code block "
                            "detected across multiple files."
                        ),
                        file=filename,
                        line=line,
                        suggestion=(
                            "Review whether common logic "
                            "can be extracted into a helper."
                        ),
                    )
                )

        return issues


class DependencyAnalyzer:
    """Extracts imports and builds a dependency graph."""

    def analyze_file(
        self,
        text: str,
        filename: str,
        language: str,
    ) -> list[DependencyInfo]:
        if language == "python":
            return _extract_python_imports(
                text,
                filename,
            )

        return _extract_generic_imports(
            text,
            filename,
            language,
        )

    @staticmethod
    def build_graph(
        dependencies: Iterable[DependencyInfo],
    ) -> dict[str, list[str]]:
        graph = defaultdict(set)

        for dependency in dependencies:
            graph[dependency.source_file].add(
                dependency.dependency
            )

        return {
            filename: sorted(items)
            for filename, items in graph.items()
        }

    @staticmethod
    def external_dependencies(
        dependencies: Iterable[DependencyInfo],
        local_modules: Optional[set[str]] = None,
    ) -> list[str]:
        local_modules = local_modules or set()

        external = set()

        for dependency in dependencies:
            name = dependency.dependency.split(".")[0]

            if name and name not in local_modules:
                external.add(name)

        return sorted(external)


class QualityScorer:
    """Calculates an indicative project quality score."""

    WEIGHTS = {
        "high": 10,
        "medium": 5,
        "low": 2,
    }

    def score(
        self,
        issues: Iterable[CodeIssue],
        documentation_coverage: float,
        average_complexity: float,
    ) -> tuple[float, str]:
        penalty = sum(
            self.WEIGHTS.get(issue.severity, 0)
            for issue in issues
        )

        documentation_penalty = (
            100 - documentation_coverage
        ) * 0.08

        complexity_penalty = max(
            0,
            average_complexity - 5,
        ) * 1.5

        score = max(
            0.0,
            min(
                100.0,
                100
                - penalty
                - documentation_penalty
                - complexity_penalty,
            ),
        )

        score = round(score, 2)

        if score >= 90:
            grade = "A"
        elif score >= 80:
            grade = "B"
        elif score >= 70:
            grade = "C"
        elif score >= 60:
            grade = "D"
        else:
            grade = "Needs Improvement"

        return score, grade


class AdvancedAnalyzer:
    """Coordinates all analysis modules."""

    def __init__(
        self,
        root: str | Path,
        complexity_warning: int = 10,
        max_line_length: int = 120,
    ) -> None:
        self.root = Path(root).resolve()

        self.complexity_analyzer = ComplexityAnalyzer(
            warning_threshold=complexity_warning,
        )

        self.security_analyzer = SecurityAnalyzer()
        self.smell_analyzer = CodeSmellAnalyzer(
            max_line_length=max_line_length,
        )
        self.naming_analyzer = NamingAnalyzer()
        self.documentation_analyzer = DocumentationAnalyzer()
        self.duplicate_analyzer = DuplicateCodeAnalyzer()
        self.dependency_analyzer = DependencyAnalyzer()
        self.quality_scorer = QualityScorer()

    def _read_source_files(self) -> dict[str, str]:
        sources = {}

        for path in self.root.rglob("*"):
            if not path.is_file():
                continue

            if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue

            if any(
                part.startswith(".")
                or part in {
                    "node_modules",
                    "__pycache__",
                    "venv",
                    ".venv",
                    "dist",
                    "build",
                }
                for part in path.parts
            ):
                continue

            try:
                if path.stat().st_size > 5 * 1024 * 1024:
                    continue

                sources[
                    path.relative_to(self.root).as_posix()
                ] = path.read_text(
                    encoding="utf-8",
                    errors="replace",
                )
            except OSError:
                continue

        return sources

    def analyze(self) -> AnalysisReport:
        if not self.root.exists() or not self.root.is_dir():
            raise ValueError(
                f"Invalid project directory: {self.root}"
            )

        sources = self._read_source_files()

        all_functions = []
        all_classes = []
        all_dependencies = []
        all_issues = []
        file_analyses = []

        total_documented = 0
        total_functions = 0
        complexities = []

        for filename, content in sources.items():
            path = Path(filename)
            language = _language(path)
            lines = content.splitlines()

            if language == "python":
                functions = _extract_python_functions(
                    content,
                    filename,
                )

                classes = _extract_python_classes(
                    content,
                    filename,
                )
            else:
                functions = self._generic_functions(
                    content,
                    filename,
                    language,
                )

                classes = [
                    ClassInfo(
                        name=name,
                        file=filename,
                        start_line=line,
                        language=language,
                    )
                    for name, line in _find_class_matches(
                        content,
                        language,
                    )
                ]

            dependencies = self.dependency_analyzer.analyze_file(
                content,
                filename,
                language,
            )

            complexity_issues = (
                self.complexity_analyzer.analyze(functions)
            )

            security_issues = (
                self.security_analyzer.analyze(
                    content,
                    filename,
                )
            )

            smell_issues = self.smell_analyzer.analyze(
                content,
                filename,
                language,
            )

            naming_issues = self.naming_analyzer.analyze(
                content,
                filename,
                language,
            )

            documentation_coverage, documentation_issues = (
                self.documentation_analyzer.analyze(
                    content,
                    filename,
                    language,
                    functions,
                )
            )

            issues = (
                complexity_issues
                + security_issues
                + smell_issues
                + naming_issues
                + documentation_issues
            )

            complexities.extend(
                function.complexity
                for function in functions
            )

            total_documented += sum(
                1
                for function in functions
                if function.documented
            )

            total_functions += len(functions)

            all_functions.extend(functions)
            all_classes.extend(classes)
            all_dependencies.extend(dependencies)
            all_issues.extend(issues)

            file_analyses.append(
                FileAnalysis(
                    path=filename,
                    language=language,
                    lines=len(lines),
                    functions=len(functions),
                    classes=len(classes),
                    average_complexity=round(
                        sum(
                            f.complexity
                            for f in functions
                        ) / len(functions),
                        2,
                    ) if functions else 0.0,
                    maximum_complexity=max(
                        (
                            f.complexity
                            for f in functions
                        ),
                        default=0,
                    ),
                    documentation_coverage=(
                        documentation_coverage
                    ),
                    issues=issues,
                )
            )

        duplicate_issues = self.duplicate_analyzer.analyze(
            sources
        )

        all_issues.extend(duplicate_issues)

        average_complexity = round(
            sum(complexities) / len(complexities),
            2,
        ) if complexities else 0.0

        documentation_coverage = round(
            total_documented / total_functions * 100,
            2,
        ) if total_functions else 100.0

        quality_score, quality_grade = (
            self.quality_scorer.score(
                all_issues,
                documentation_coverage,
                average_complexity,
            )
        )

        return AnalysisReport(
            root=str(self.root),
            files_analyzed=len(sources),
            total_functions=len(all_functions),
            total_classes=len(all_classes),
            average_complexity=average_complexity,
            maximum_complexity=max(
                complexities,
                default=0,
            ),
            documentation_coverage=documentation_coverage,
            issues=all_issues,
            functions=all_functions,
            classes=all_classes,
            dependencies=all_dependencies,
            file_analyses=file_analyses,
            quality_score=quality_score,
            quality_grade=quality_grade,
        )

    @staticmethod
    def _generic_functions(
        content: str,
        filename: str,
        language: str,
    ) -> list[FunctionInfo]:
        matches = _find_function_matches(
            content,
            language,
        )

        lines = content.splitlines()
        results = []

        for name, start in matches:
            end = min(
                len(lines),
                start + 1,
            )

            # Estimate the function block using braces.
            if language in {
                "javascript", "java", "c", "cpp",
                "csharp", "go", "rust", "php",
                "swift", "kotlin", "dart", "scala",
            }:
                depth = 0
                found_opening = False

                for index in range(start - 1, len(lines)):
                    depth += lines[index].count("{")
                    depth -= lines[index].count("}")

                    if "{" in lines[index]:
                        found_opening = True

                    if found_opening and depth <= 0:
                        end = index + 1
                        break

            source = "\n".join(lines[start - 1:end])

            results.append(
                FunctionInfo(
                    name=name,
                    file=filename,
                    start_line=start,
                    end_line=end,
                    line_count=max(1, end - start + 1),
                    complexity=_complexity(
                        source,
                        language,
                    ),
                    parameters=0,
                    documented=False,
                    language=language,
                )
            )

        return results


class AnalysisReportExporter:
    """Serializes advanced analysis reports."""

    @staticmethod
    def to_dict(
        report: AnalysisReport,
    ) -> dict[str, Any]:
        return asdict(report)

    @staticmethod
    def to_json(
        report: AnalysisReport,
        destination: str | Path,
    ) -> Path:
        path = Path(destination)
        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        path.write_text(
            json.dumps(
                AnalysisReportExporter.to_dict(report),
                indent=4,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        return path

    @staticmethod
    def to_csv(
        report: AnalysisReport,
        destination: str | Path,
    ) -> Path:
        import csv

        path = Path(destination)
        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        with path.open(
            "w",
            newline="",
            encoding="utf-8",
        ) as file:
            writer = csv.writer(file)

            writer.writerow([
                "File",
                "Language",
                "Lines",
                "Functions",
                "Classes",
                "Average Complexity",
                "Maximum Complexity",
                "Documentation Coverage",
                "Issue Count",
            ])

            for item in report.file_analyses:
                writer.writerow([
                    item.path,
                    item.language,
                    item.lines,
                    item.functions,
                    item.classes,
                    item.average_complexity,
                    item.maximum_complexity,
                    item.documentation_coverage,
                    len(item.issues),
                ])

        return path


class AnalysisConsole:
    """Prints a concise advanced analysis summary."""

    @staticmethod
    def display(report: AnalysisReport) -> None:
        print("\n" + "=" * 60)
        print("             DEVSCOPE ADVANCED ANALYSIS")
        print("=" * 60)

        print(f"Project: {report.root}")
        print(f"Files analyzed: {report.files_analyzed}")
        print(f"Functions: {report.total_functions}")
        print(f"Classes: {report.total_classes}")

        print("\nCOMPLEXITY")
        print("-" * 60)
        print(
            f"Average complexity: "
            f"{report.average_complexity}"
        )
        print(
            f"Maximum complexity: "
            f"{report.maximum_complexity}"
        )

        print("\nDOCUMENTATION")
        print("-" * 60)
        print(
            f"Coverage: {report.documentation_coverage}%"
        )

        print("\nQUALITY INDICATOR")
        print("-" * 60)
        print(f"Score: {report.quality_score}/100")
        print(f"Grade: {report.quality_grade}")

        severity_counts = Counter(
            issue.severity
            for issue in report.issues
        )

        print("\nISSUE SUMMARY")
        print("-" * 60)

        for severity in ("high", "medium", "low"):
            print(
                f"{severity.title():<15}: "
                f"{severity_counts.get(severity, 0)}"
            )

        print(
            f"{'Total':<15}: {len(report.issues)}"
        )

        print("\nTOP FINDINGS")
        print("-" * 60)

        for issue in report.issues[:25]:
            print(
                f"[{issue.severity.upper()}] "
                f"{issue.file}:{issue.line} "
                f"- {issue.message}"
            )

        if len(report.issues) > 25:
            print(
                f"... and {len(report.issues) - 25} "
                "additional findings."
            )

        print("=" * 60)


def analyze_project(
    root: str | Path,
) -> AnalysisReport:
    """Convenience function for analyzing a project."""

    return AdvancedAnalyzer(root).analyze()


def export_analysis(
    report: AnalysisReport,
    destination: str | Path,
) -> Path:
    """Convenience function for JSON export."""

    return AnalysisReportExporter.to_json(
        report,
        destination,
    )


def summarize_issues(
    issues: Iterable[CodeIssue],
) -> dict[str, Any]:
    """Return issue counts grouped by severity and category."""

    severity = Counter()
    categories = Counter()

    for issue in issues:
        severity[issue.severity] += 1
        categories[issue.category] += 1

    return {
        "total": sum(severity.values()),
        "by_severity": dict(severity),
        "by_category": dict(categories),
    }


def filter_issues(
    issues: Iterable[CodeIssue],
    severity: Optional[str] = None,
    category: Optional[str] = None,
    filename: Optional[str] = None,
) -> list[CodeIssue]:
    """Filter findings by severity, category, or filename."""

    filtered = []

    for issue in issues:
        if severity and issue.severity != severity:
            continue

        if category and issue.category != category:
            continue

        if filename and filename not in issue.file:
            continue

        filtered.append(issue)

    return filtered


def rank_files_by_issues(
    report: AnalysisReport,
) -> list[tuple[str, int]]:
    """Rank files by the number of detected issues."""

    counts = Counter(
        issue.file
        for issue in report.issues
    )

    return counts.most_common()


def group_issues_by_file(
    issues: Iterable[CodeIssue],
) -> dict[str, list[CodeIssue]]:
    """Organize findings by source file."""

    grouped = defaultdict(list)

    for issue in issues:
        grouped[issue.file].append(issue)

    return dict(grouped)


def find_unused_import_candidates(
    dependencies: Iterable[DependencyInfo],
    source_files: dict[str, str],
) -> dict[str, list[str]]:
    """
    Identify possible unused imports through text matching.

    This is an approximate check. It does not account for every
    language's scope, reflection, or dynamic import behavior.
    """

    candidates = defaultdict(list)

    for dependency in dependencies:
        content = source_files.get(
            dependency.source_file,
            "",
        )

        name = dependency.dependency.split(".")[-1]

        if not name:
            continue

        occurrences = len(
            re.findall(
                rf"\b{re.escape(name)}\b",
                content,
            )
        )

        if occurrences <= 1:
            candidates[dependency.source_file].append(
                dependency.dependency
            )

    return dict(candidates)


def calculate_file_risk(
    file_analysis: FileAnalysis,
) -> dict[str, Any]:
    """Calculate a simple risk indicator for one file."""

    risk = 0

    if file_analysis.maximum_complexity >= 20:
        risk += 30
    elif file_analysis.maximum_complexity >= 10:
        risk += 15

    if file_analysis.lines > 500:
        risk += 20
    elif file_analysis.lines > 300:
        risk += 10

    severity_weights = {
        "high": 15,
        "medium": 8,
        "low": 3,
    }

    for issue in file_analysis.issues:
        risk += severity_weights.get(
            issue.severity,
            0,
        )

    risk = min(100, risk)

    if risk >= 70:
        level = "high"
    elif risk >= 35:
        level = "medium"
    else:
        level = "low"

    return {
        "file": file_analysis.path,
        "risk_score": risk,
        "risk_level": level,
    }


def build_dependency_matrix(
    dependencies: Iterable[DependencyInfo],
) -> dict[str, list[str]]:
    """Create a serializable source-to-dependency matrix."""

    matrix = defaultdict(set)

    for item in dependencies:
        matrix[item.source_file].add(item.dependency)

    return {
        source: sorted(targets)
        for source, targets in matrix.items()
    }


def get_analysis_statistics(
    report: AnalysisReport,
) -> dict[str, Any]:
    """Return additional statistics from an analysis report."""

    issues = report.issues

    return {
        "files": report.files_analyzed,
        "functions": report.total_functions,
        "classes": report.total_classes,
        "dependencies": len(report.dependencies),
        "issues": len(issues),
        "security_issues": sum(
            issue.category == "security"
            for issue in issues
        ),
        "complexity_issues": sum(
            issue.category == "complexity"
            for issue in issues
        ),
        "documentation_issues": sum(
            issue.category == "documentation"
            for issue in issues
        ),
        "average_complexity": report.average_complexity,
        "maximum_complexity": report.maximum_complexity,
        "quality_score": report.quality_score,
        "quality_grade": report.quality_grade,
    }
