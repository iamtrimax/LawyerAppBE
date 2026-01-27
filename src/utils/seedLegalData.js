const mongoose = require('mongoose');
const LegalResource = require('../model/legalResource.model');
require('dotenv').config();

const sampleData = [
    {
        title: "Law on Enterprises 2020: Key Highlights",
        description: "An overview of the fundamental changes in the Vietnamese Law on Enterprises for foreign investors.",
        content: `
      <h2>1. Common Seal of the Enterprise</h2>
      <p>Enterprises have the right to decide on the type, number, form, and content of their seals. Digital signatures can now be used as seals.</p>
      <h2>2. Rights and Obligations of Shareholders</h2>
      <p>The 2020 Law reduces the threshold for shareholders or groups of shareholders to exercise certain rights (from 10% to 5% of ordinary shares).</p>
      <h2>3. State-Owned Enterprises (SOE)</h2>
      <p>Redefines SOEs as enterprises where the State holds more than 50% of the charter capital or voting shares.</p>
    `,
        category: "Corporate",
        language: "English",
        thumbnail: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=500&auto=format&fit=crop"
    },
    {
        title: "Commercial Law: International Sale of Goods",
        description: "Understanding the legal framework for international trade contracts under Vietnamese Law.",
        content: `
      <h2>1. Formation of Contracts</h2>
      <p>A contract for the international sale of goods must be made in writing or in other forms with equivalent legal validity.</p>
      <h2>2. Rights of the Buyer</h2>
      <p>The buyer has the right to demand delivery of goods, claim damages, or terminate the contract if the seller breaches fundamental obligations.</p>
      <h2>3. Dispute Resolution</h2>
      <p>Parties are encouraged to resolve disputes through negotiation or mediation before seeking arbitration or court intervention.</p>
    `,
        category: "Commercial",
        language: "English",
        thumbnail: "https://images.unsplash.com/photo-1578575437130-527eed3abbec?q=80&w=500&auto=format&fit=crop"
    },
    {
        title: "Vietnam Tax System Overview 2024",
        description: "Guidance on Corporate Income Tax (CIT) and Value Added Tax (VAT) for businesses.",
        content: `
      <h2>1. Corporate Income Tax (CIT)</h2>
      <p>The standard CIT rate is 20%. Tax incentives are available for projects in encouraged sectors or disadvantaged geographical areas.</p>
      <h2>2. Value Added Tax (VAT)</h2>
      <p>Standard rate is 10%. Some essential goods and services enjoy a 5% rate, while exports are generally 0%.</p>
      <h2>3. Personal Income Tax (PIT)</h2>
      <p>Progressive tax rates apply to residents' global income, ranging from 5% to 35%.</p>
    `,
        category: "Tax",
        language: "English",
        thumbnail: "https://images.unsplash.com/photo-1554224155-1697216efe9c?q=80&w=500&auto=format&fit=crop"
    },
    {
        title: "Accounting Standards and Financial Reporting",
        description: "Introduction to Vietnamese Accounting Standards (VAS) and the roadmap to IFRS.",
        content: `
      <h2>1. Vietnamese Accounting Standards (VAS)</h2>
      <p>Most entities in Vietnam are still required to use VAS for their statutory financial statements.</p>
      <h2>2. Roadmap to IFRS</h2>
      <p>The Ministry of Finance has introduced a roadmap for the voluntary and mandatory adoption of IFRS for certain types of entities by 2025.</p>
      <h2>3. Retention of Records</h2>
      <p>Accounting documents must be kept for at least 5 to 10 years depending on the type of document.</p>
    `,
        category: "Accounting",
        language: "English",
        thumbnail: "https://images.unsplash.com/photo-1454165833762-0105b007ea08?q=80&w=500&auto=format&fit=crop"
    }
];

const seedData = async () => {
    try {
        // Kết nối Database
        await mongoose.connect(process.env.URL_DB || 'mongodb://localhost:27017/lawyerDB');
        console.log("Connected to MongoDB for seeding...");

        // Xóa dữ liệu cũ (Tùy chọn - nếu bạn muốn làm sạch kho dữ liệu trước khi nạp)
        // await LegalResource.deleteMany({ language: 'English' });

        for (const data of sampleData) {
            // Sử dụng upsert để tránh trùng lặp nếu tiêu đề giống hệt nhau
            await LegalResource.findOneAndUpdate(
                { title: data.title },
                data,
                { upsert: true, new: true }
            );
        }

        console.log("Seeding successful! English Legal Data is now available.");
        process.exit();
    } catch (error) {
        console.error("Seeding failed:", error);
        process.exit(1);
    }
};

seedData();
