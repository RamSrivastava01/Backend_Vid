const asyncHandler = function (requestHandler) {
    return (req, res, next) => {
        Promise.resolve(requestHandler(res, res, next)).catch((err) => {
            next(err);
        });
    };
};

export { asyncHandler };
