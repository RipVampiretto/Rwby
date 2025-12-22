/**
 * Context Factory for Telegram Bot Tests
 * Creates mock Grammy context objects for testing
 */

/**
 * Create a mock user object
 */
function createUserMock(overrides = {}) {
    return {
        id: 123456789,
        is_bot: false,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'en',
        ...overrides
    };
}

/**
 * Create a mock chat object
 */
function createChatMock(overrides = {}) {
    return {
        id: -1001234567890,
        type: 'supergroup',
        title: 'Test Group',
        username: 'testgroup',
        ...overrides
    };
}

/**
 * Create a mock message object
 */
function createMessageMock(overrides = {}) {
    const from = overrides.from || createUserMock();
    const chat = overrides.chat || createChatMock();

    return {
        message_id: Math.floor(Math.random() * 100000),
        from,
        chat,
        date: Math.floor(Date.now() / 1000),
        text: 'Test message',
        ...overrides
    };
}

/**
 * Create a full mock context for message handling
 */
function createMessageContext(messageOverrides = {}, ctxOverrides = {}) {
    const message = createMessageMock(messageOverrides);

    const ctx = {
        message,
        from: message.from,
        chat: message.chat,
        me: { username: 'test_bot' },

        // User tier (set by middleware normally)
        userTier: ctxOverrides.userTier || 0,

        // API methods (mocked)
        reply: jest.fn().mockResolvedValue({ message_id: 1 }),
        replyWithHTML: jest.fn().mockResolvedValue({ message_id: 1 }),
        deleteMessage: jest.fn().mockResolvedValue(true),
        banChatMember: jest.fn().mockResolvedValue(true),
        restrictChatMember: jest.fn().mockResolvedValue(true),
        editMessageText: jest.fn().mockResolvedValue(true),
        answerCallbackQuery: jest.fn().mockResolvedValue(true),

        // API object for direct calls
        api: {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            deleteMessage: jest.fn().mockResolvedValue(true),
            banChatMember: jest.fn().mockResolvedValue(true),
            getChatMember: jest.fn().mockResolvedValue({ status: 'member' }),
            getFile: jest.fn().mockResolvedValue({ file_path: 'test/path.jpg' }),
            ...ctxOverrides.api
        },

        ...ctxOverrides
    };

    return ctx;
}

/**
 * Create a callback query context
 */
function createCallbackContext(data, overrides = {}) {
    const from = overrides.from || createUserMock();
    const chat = overrides.chat || createChatMock();

    const callbackQuery = {
        id: 'callback_query_id',
        from,
        chat_instance: 'test_instance',
        data,
        message: {
            message_id: 123,
            from: { id: 999, is_bot: true, first_name: 'Bot' },
            chat,
            date: Math.floor(Date.now() / 1000),
            text: 'Original message'
        }
    };

    return {
        callbackQuery,
        from,
        chat,
        me: { username: 'test_bot' },
        userTier: overrides.userTier || 0,

        reply: jest.fn().mockResolvedValue({ message_id: 1 }),
        editMessageText: jest.fn().mockResolvedValue(true),
        editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
        answerCallbackQuery: jest.fn().mockResolvedValue(true),
        deleteMessage: jest.fn().mockResolvedValue(true),

        api: {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessageText: jest.fn().mockResolvedValue(true),
            getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }),
            ...overrides.api
        },

        ...overrides
    };
}

/**
 * Create a private chat context
 */
function createPrivateContext(messageOverrides = {}, ctxOverrides = {}) {
    return createMessageContext(
        {
            chat: { id: 123456789, type: 'private', first_name: 'Test' },
            ...messageOverrides
        },
        ctxOverrides
    );
}

/**
 * Create a message with media
 */
function createMediaContext(mediaType, mediaOverrides = {}, ctxOverrides = {}) {
    const mediaContent = {
        photo: [{ file_id: 'photo_file_id', width: 800, height: 600 }],
        video: { file_id: 'video_file_id', duration: 10, width: 1920, height: 1080 },
        animation: { file_id: 'gif_file_id', duration: 3, width: 480, height: 480 },
        sticker: { file_id: 'sticker_file_id', width: 512, height: 512 },
        document: { file_id: 'document_file_id', file_name: 'test.pdf' }
    };

    const message = {
        [mediaType]: mediaContent[mediaType],
        caption: mediaOverrides.caption || null,
        ...mediaOverrides
    };

    // Remove text if it's a media message without caption
    delete message.text;

    return createMessageContext(message, ctxOverrides);
}

/**
 * Create a reply-to-message context
 */
function createReplyContext(replyToMessage, messageOverrides = {}, ctxOverrides = {}) {
    return createMessageContext(
        {
            reply_to_message: replyToMessage,
            ...messageOverrides
        },
        ctxOverrides
    );
}

module.exports = {
    createUserMock,
    createChatMock,
    createMessageMock,
    createMessageContext,
    createCallbackContext,
    createPrivateContext,
    createMediaContext,
    createReplyContext
};
