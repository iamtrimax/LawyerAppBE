const mongoose = require('mongoose');
const { extractGraphFromBatch } = require('./src/services/graphExtraction.service');
const Article = require('./src/model/article.model');
require('dotenv').config();

async function test() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const articles = await Article.find({ status: 'Published' }).limit(2);
        console.log("Found articles:", articles.map(a => a.title));
        
        const result = await extractGraphFromBatch(articles);
        console.log("Result:", result ? "Success" : "Failed");
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
test();
