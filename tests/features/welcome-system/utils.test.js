/**
 * Tests for welcome-system/utils.js
 */

const { parseButtonConfig, replaceWildcards } = require('../../../src/features/welcome-system/utils');

describe('Welcome System Utils', () => {
    describe('replaceWildcards()', () => {
        it('should replace {first_name} placeholder', () => {
            const user = { first_name: 'John', last_name: 'Doe', username: 'johndoe', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Welcome {first_name}!';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('John');
        });

        it('should replace {last_name} placeholder', () => {
            const user = { first_name: 'John', last_name: 'Doe', username: 'johndoe', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Hello {last_name}';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('Doe');
        });

        it('should replace {username} placeholder', () => {
            const user = { first_name: 'John', last_name: 'Doe', username: 'johndoe', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Hey {username}';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('johndoe');
        });

        it('should replace {chat_title} placeholder', () => {
            const user = { first_name: 'John', id: 123 };
            const chat = { title: 'My Awesome Group', id: -100123 };
            const template = 'Welcome to {chat_title}!';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('My Awesome Group');
        });

        it('should replace {id} placeholder', () => {
            const user = { first_name: 'John', id: 12345678 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Your ID is {id}';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('12345678');
        });

        it('should handle missing last_name', () => {
            const user = { first_name: 'John', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Hello {first_name} {last_name}';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('John');
            expect(result).not.toContain('undefined');
        });

        it('should handle missing username', () => {
            const user = { first_name: 'John', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Contact: {username}';

            const result = replaceWildcards(template, user, chat);
            expect(result).not.toContain('undefined');
        });

        it('should handle multiple placeholders', () => {
            const user = { first_name: 'John', last_name: 'Doe', username: 'johndoe', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Welcome {first_name} {last_name} ({username}) to {chat_title}!';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('John');
            expect(result).toContain('Doe');
            expect(result).toContain('johndoe');
            expect(result).toContain('Test Group');
        });

        it('should return empty string for null template', () => {
            const user = { first_name: 'John', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };

            const result = replaceWildcards(null, user, chat);
            expect(result).toBe('');
        });

        it('should create mention with link', () => {
            const user = { first_name: 'John', id: 123 };
            const chat = { title: 'Test Group', id: -100123 };
            const template = 'Hello {mention}';

            const result = replaceWildcards(template, user, chat);
            expect(result).toContain('tg://user?id=123');
            expect(result).toContain('John');
        });
    });

    describe('parseButtonConfig()', () => {
        it('should handle null input', () => {
            const buttons = parseButtonConfig(null);
            expect(buttons).toEqual([]);
        });

        it('should handle already parsed array', () => {
            const input = [[{ text: 'Button', url: 'https://example.com' }]];
            const buttons = parseButtonConfig(input);

            expect(buttons).toEqual(input);
        });

        it('should extract inline_keyboard from object', () => {
            const input = {
                inline_keyboard: [[{ text: 'Button', url: 'https://example.com' }]]
            };
            const buttons = parseButtonConfig(input);

            expect(buttons).toHaveLength(1);
            expect(buttons[0][0].text).toBe('Button');
        });

        it('should parse JSON string', () => {
            const json = '[[{"text": "Rules", "url": "https://example.com"}]]';
            const buttons = parseButtonConfig(json);

            expect(buttons).toHaveLength(1);
            expect(buttons[0][0].text).toBe('Rules');
        });

        it('should return empty array for invalid JSON', () => {
            const buttons = parseButtonConfig('not valid json');
            expect(buttons).toEqual([]);
        });

        it('should handle inline_keyboard in JSON string', () => {
            const json = '{"inline_keyboard": [[{"text": "Row1"}]]}';
            const buttons = parseButtonConfig(json);

            expect(buttons).toHaveLength(1);
        });
    });
});
