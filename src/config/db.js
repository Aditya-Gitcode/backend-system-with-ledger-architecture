const mongoose = require('mongoose');
function connectToDb(){
    mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Server is Connected to Database");
    }).catch((err) => {
        console.log("Error Connecting to Database");
        console.log(err);
        process.exit(1)
    });
}

module.exports = connectToDb