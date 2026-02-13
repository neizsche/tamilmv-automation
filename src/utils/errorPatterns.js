function createSuccess(data = null, message = '') {
    return {
        success: true,
        data,
        message
    };
}

function createFailure(error, data = null) {
    const errorObj = error instanceof Error ? error : new Error(error);

    return {
        success: false,
        error: errorObj,
        message: errorObj.message,
        data
    };
}

async function safeExecute(fn, operationName = 'operation') {
    try {
        const data = await fn();
        return createSuccess(data);
    } catch (error) {
        return createFailure(error);
    }
}

function createRadarrResult({ added = false, exists = false, hasFile = false, title = '', year = '', notified = false }) {
    return {
        added,
        exists,
        hasFile,
        title,
        year,
        notified
    };
}

function withErrorLogging(fn, logger, operationName) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            logger.error(`${operationName} failed`, error);
            throw error;
        }
    };
}

module.exports = {
    createSuccess,
    createFailure,
    safeExecute,
    createRadarrResult,
    withErrorLogging
};
