import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.models.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/apiResponse.js";

const registerUser = asyncHandler(async (req, res) => {
    //
    console.log("BODY:", req.body);
    console.log("FILES:", req.files);
    const { fullName, userName, email, password } = req.body;
    if (
        [fullName, email, userName, password].some(
            (fields) => fields?.trim() == ""
        )
    ) {
        throw new ApiError(400, "Full name is require for registering");
    }
    //checking the user exists or not
    const existedUser = await User.findOne({
        $or: [{ userName }, { email }],
    });

    if (existedUser) {
        throw new ApiError(409, "User already exists");
    }

    const avatarLocalPath = req.file?.avatar[0]?.path;
    const coverLocalPath = req.file?.coverImage[0]?.path;
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    let coverImage = "";
    if (coverLocalPath) {
        coverImage = await uploadOnCloudinary(coverLocalPath);
    }

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        userName: userName.toLowerCase(),
    });
    const createUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );
    if (!createUser) {
        throw new ApiError(500, "something went wrong while creating user");
    }

    return res
        .status(201)
        .json(new ApiResponse(201, createUser, "User registered successfully"));
});

export { registerUser };
