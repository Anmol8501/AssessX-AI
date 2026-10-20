
const fs = require("fs");

function findKey(data, targetKey, currentPath = "$", results = []) {
    if (Array.isArray(data)) {
        data.forEach((value, index) => {
            findKey(value, targetKey, `${currentPath}[${index}]`, results);
        });
    } else if (data !== null && typeof data === "object") {
        for (const [key, value] of Object.entries(data)) {
            const nextPath = `${currentPath}.${key}`;

            if (key.toLowerCase() === targetKey.toLowerCase()) {
                results.push({
                    path: nextPath,
                    value
                });
            }

            findKey(value, targetKey, nextPath, results);
        }
    }

    return results;
}

function main() {
    const [, , filePath, targetKey] = process.argv;

    if (!filePath || !targetKey) {
        console.error(
            "Usage: node json-search.js <file.json> <key>"
        );
        process.exitCode = 1;
        return;
    }

    try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const results = findKey(data, targetKey);

        if (results.length === 0) {
            console.log(`No matches found for "${targetKey}".`);
            return;
        }

        console.log(`Found ${results.length} match(es):`);

        for (const result of results) {
            console.log(`Path: ${result.path}`);
            console.log("Value:", JSON.stringify(result.value));
        }
    } catch (error) {
        console.error("Search failed:", error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = { findKey };
