import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.models.js";
import {
    uploadOnCloudinary,
    deleteFromCloudinary,
} from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/apiResponse.js";
import { upload } from "../middlewares/multer.middleware.js";

const generateAccessTokenAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (user) {
            const accessToken = user.generateAccessToken();
            const refreshToken = user.generateRefreshToken();
            user.refreshToken = refreshToken;
            await user.save({ validateBeforeSave: false });
            return { accessToken, refreshToken };
        }
    } catch (err) {
        throw new ApiError(400, "No user found in database");
    }
};

const registerUser = asyncHandler(async (req, res) => {
    const { fullname, email, username, password } = req.body;

    if (
        [fullname, email, username, password].some(
            (field) => field?.trim() === ""
        )
    ) {
        throw new ApiError(400, "All fields are required");
    }

    const existedUser = await User.findOne({
        $or: [{ username }, { email }],
    });

    if (existedUser) {
        throw new ApiError(409, "User with email or username already exists");
    }
    console.log(req.files);

    let avatarLocalPath = req.files?.avatar[0]?.path;
    let coverImageLocalPath = req.files?.coverImage[0]?.path;

    if (
        req.files &&
        Array.isArray(req.files.coverImage) &&
        req.files.coverImage.length > 0
    ) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    // const avatar = await uploadOnCloudinary(avatarLocalPath);
    // const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    // if (!avatar) {
    //     throw new ApiError (400, "Avatar file is required");
    // }

    let avatar;
    try {
        avatar = await uploadOnCloudinary(avatarLocalPath);
        console.log("uploaded avatar", avatar);
    } catch (error) {
        console.log("Error uploading avatar : ");
        throw new ApiError(400, "Failed to load avatar");
    }

    let coverImage;
    try {
        coverImage = await uploadOnCloudinary(coverImageLocalPath);
        console.log("uploaded coverImage", coverImage);
    } catch (error) {
        console.log("Error uploading coverImage : ");
        throw new ApiError(400, "Failed to load coverImage");
    }
    try {
        const user = await User.create({
            fullname,
            avatar: avatar.url,
            coverImage: coverImage?.url || "",
            email,
            password,
            username: username.toLowerCase(),
        });

        const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
        );

        if (!createdUser) {
            throw new ApiError(
                500,
                "Something went wrong while registering the user"
            );
        }

        return res
            .status(201)
            .json(
                new ApiResponse(
                    200,
                    createdUser,
                    "User registered Successfully"
                )
            );
    } catch (error) {
        console.log("user creation failed");
        if (avatar) {
            await deleteFromCloudinary(avatar.public_id);
        }
        if (coverImage) {
            await deleteFromCloudinary(coverImage.public_id);
        }

        throw new ApiError(
            500,
            "Something went wrong while registering a user and images were deleted"
        );
    }
});

const loginUser = asyncHandler(async (req, res) => {
    //Get data from request body
    const { email, username, password } = req.body;

    if (!email) {
        throw new ApiError(500, "Email is required for Login");
    }

    const user = await User.findOne({
        $or: [{ username }, { email }],
    });

    //Validate password
    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "User credential incorrent");
    }

    const { accessToken, refreshToken } =
        await generateAccessTokenAndRefreshToken(user._id);
    const loggedInUser = await User.findById(user._id).select(
        "-passowrd -refreshToken"
    );

    if (!loggedInUser) {
        throw new ApiError(400, "No logged in user found in database");
    }

    const options = {
        httpOnly: true,
        secure: (process.env.NODE_ENV = "production"),
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                { user: loggedInUser, accessToken, refreshToken },
                "User loggin successfully"
            )
        );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken =
        req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "No refresh Token found");
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        const user = await User.findById(decodedToken?._id);
        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== user.refreshToken) {
            throw new ApiError(401, "Refresh token Expired");
        }

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
        };

        const { accessToken, refreshToken: newRefreshToken } =
            await generateAccessTokenAndRefreshToken(user._id);

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    accessToken,
                    { refreshToken: newRefreshToken },
                    "Access Token refreshed successfully"
                )
            );
    } catch (error) {
        throw new ApiError(
            500,
            "something went wrong while refreshing access token"
        );
    }
});

const logOutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined,
            },
        },
        {
            new: true,
        }
    );

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
    };

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(200, new ApiResponse(200, {}, "user logged out successfully"));
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user?._id);
    const isPasswordValid = user.isPasswordCorrect(oldPassword);
    if (!isPasswordValid) {
        throw new ApiError(
            500,
            "Password does not match. Enter correct password"
        );
    }

    user.password = newPassword;
    await user.save({ validateBeforeSave: false });
    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Password changed successfully"));
});
const getCurrentUser = asyncHandler(async (req, res) => {
    res.status(200).json(
        new ApiResponse(200, req.user, "Current user details")
    );
});
const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullname, email } = req.body;
    if (!fullname || !email) {
        throw new ApiError(400, "Email and fullname are required");
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname,
                email: email,
            },
        },
        {
            new: true,
        }
    ).select("-password refreshToken");

    return res
        .status(200)
        .json(
            new ApiResponse(200, user, "Account details updated successfully")
        );
});
const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;
    if (!avatarLocalPath) {
        throw new ApiError(404, "Upload avatar to update it");
    }
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    if (!avatar.url) {
        throw new ApiError(400, "Something went wrong while uploading avatar");
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url,
            },
        },
        { new: true }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, user, "Avatar changed successfully"));
});
const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;
    if (!coverImageLocalPath) {
        throw new ApiError(404, "Cover image not found");
    }
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);
    if (!coverImage.url) {
        throw new ApiError(404, "Cover image upload failed ");
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url,
            },
        },
        {
            new: true,
        }
    ).select("-password -refreshToken");
    return res
        .status(200)
        .json(new ApiResponse(200, user, "Cover image updated successfully"));
});

export {
    registerUser,
    loginUser,
    refreshAccessToken,
    logOutUser,
    changeCurrentPassword,
    updateAccountDetails,
    getCurrentUser,
    updateUserAvatar,
    updateUserCoverImage,
};
