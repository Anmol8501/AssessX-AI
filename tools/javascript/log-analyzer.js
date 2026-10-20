
const fs = require("fs");
const path = require("path");

const LEVELS = ["ERROR", "WARN", "INFO", "DEBUG"];

function readLogFile(filePath) {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File not found: ${resolvedPath}`);
    }

    if (!fs.statSync(resolvedPath).isFile()) {
        throw new Error("The supplied path is not a file.");
    }

    return fs.readFileSync(resolvedPath, "utf8")
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0);
}

function detectLevel(line) {
    const match = line.match(/\b(ERROR|WARN|INFO|DEBUG)\b/i);
    return match ? match[1].toUpperCase() : "OTHER";
}

function analyzeLogs(lines) {
    const summary = {
        total: lines.length,
        levels: Object.fromEntries(
            [...LEVELS, "OTHER"].map(level => [level, 0])
        ),
        errors: [],
        empty: lines.length === 0
    };

    lines.forEach((line, index) => {
        const level = detectLevel(line);

        summary.levels[level]++;

        if (level === "ERROR") {
            summary.errors.push({
                line: index + 1,
                message: line.trim()
            });
        }
    });

    return summary;
}

function searchLogs(lines, keyword) {
    if (!keyword || !keyword.trim()) {
        throw new Error("Search keyword cannot be empty.");
    }

    const query = keyword.toLowerCase();

    return lines
        .map((message, index) => ({
            line: index + 1,
            message
        }))
        .filter(entry =>
            entry.message.toLowerCase().includes(query)
        );
}

function printReport(summary) {
    console.log("\n========== LOG REPORT ==========");
    console.log("Total log entries:", summary.total);

    for (const [level, count] of Object.entries(summary.levels)) {
        console.log(`${level.padEnd(8)}: ${count}`);
    }

    console.log("\nError details:");

    if (summary.errors.length === 0) {
        console.log("No errors found.");
    } else {
        summary.errors.forEach(error => {
            console.log(`[Line ${error.line}] ${error.message}`);
        });
    }

    console.log("================================\n");
}

function main() {
    const [, , filePath, ...searchTerms] = process.argv;

    if (!filePath) {
        console.error(
            "Usage: node log-analyzer.js <log-file> [search-term]"
        );
        process.exitCode = 1;
        return;
    }

    try {
        const lines = readLogFile(filePath);
        const summary = analyzeLogs(lines);

        printReport(summary);

        if (searchTerms.length > 0) {
            const matches = searchLogs(lines, searchTerms.join(" "));

            console.log("Search matches:", matches.length);

            matches.forEach(match => {
                console.log(`[Line ${match.line}] ${match.message}`);
            });
        }
    } catch (error) {
        console.error("Analysis failed:", error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    readLogFile,
    detectLevel,
    analyzeLogs,
    searchLogs
};
