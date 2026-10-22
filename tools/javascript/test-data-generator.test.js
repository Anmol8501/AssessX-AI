
const assert = require("node:assert/strict");
const { generateUsers } = require("./test-data-generator");

function runTests() {
    const users = generateUsers(5);

    assert.equal(users.length, 5);
    assert.equal(users[0].id, 1);
    assert.equal(users[4].id, 5);

    users.forEach((user, index) => {
        assert.equal(user.name, `Test User ${index + 1}`);
        assert.equal(
            user.email,
            `testuser${index + 1}@example.com`
        );
        assert.equal(typeof user.active, "boolean");
        assert.ok(user.score >= 0 && user.score <= 100);
    });

    assert.throws(() => generateUsers(0), /integer/);
    assert.throws(() => generateUsers(-1), /integer/);
    assert.throws(() => generateUsers(1.5), /integer/);
    assert.throws(() => generateUsers(10001), /integer/);

    assert.equal(generateUsers(1).length, 1);

    console.log("All test-data generator tests passed.");
}

runTests();
