
const fs = require("fs");

function generateUsers(count = 10) {
    if (!Number.isInteger(count) || count < 1 || count > 10000) {
        throw new Error("Count must be an integer between 1 and 10000");
    }

    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        name: `Test User ${index + 1}`,
        email: `testuser${index + 1}@example.com`,
        active: index % 2 === 0,
        score: Math.floor(Math.random() * 101)
    }));
}

function saveJSON(data, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
    console.log(`Generated ${data.length} records in ${outputPath}`);
}

function main() {
    const count = Number(process.argv[2] || 10);
    const outputPath = process.argv[3] || "test-users.json";

    try {
        const users = generateUsers(count);
        saveJSON(users, outputPath);
    } catch (error) {
        console.error("Generation failed:", error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = { generateUsers, saveJSON };
