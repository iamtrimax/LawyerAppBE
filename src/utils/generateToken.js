const jwt = require('jsonwebtoken');
require('dotenv').config();

const generateToken = (user, exp)=>{
    return jwt.sign({
        id: user._id, email: user.email, role: user.role
    }, process.env.JWT_SECRET, { expiresIn: exp })
}
module.exports = generateToken;