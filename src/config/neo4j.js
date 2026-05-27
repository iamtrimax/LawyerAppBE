const neo4j = require('neo4j-driver');
require('dotenv').config();

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'password';

let driver;

function initNeo4j() {
    try {
        driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
        console.log(`🔌 Neo4j Driver initialized (URI: ${uri})`);
    } catch (error) {
        console.error('❌ Failed to initialize Neo4j driver:', error.message);
    }
}

function getDriver() {
    if (!driver) {
        initNeo4j();
    }
    return driver;
}

async function closeNeo4j() {
    if (driver) {
        await driver.close();
        console.log('🔌 Neo4j Driver closed.');
    }
}

module.exports = {
    initNeo4j,
    getDriver,
    closeNeo4j
};
