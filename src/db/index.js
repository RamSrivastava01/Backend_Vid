import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async function () {
    try {
        const connectionInstance = await mongoose.connect(
            `${process.env.MONGODB_URI}/${DB_NAME}`
        );
        console.log(
            "connected : ",
            connectionInstance.connection.host,
            connectionInstance.connection.name
        );
    } catch (error) {
        console.log("Mongo db connection error", error);
        process.exit(1);
    }
};

export default connectDB;
