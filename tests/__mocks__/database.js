/**
 * Mock Database Module
 * Simulates PostgreSQL connection for testing
 */

const mockData = {
    guilds: new Map(),
    users: new Map(),
    wordFilters: [],
    linkRules: [],
    casBans: new Set(),
    activeVotes: [],
    userTrustFlux: new Map()
};

// Default guild config
const defaultGuildConfig = {
    guild_id: -1001234567890,
    guild_name: 'Test Group',
    staff_group_id: null,
    log_channel_id: null,
    spam_enabled: false,
    spam_sensitivity: 'medium',
    spam_action_volume: 'delete',
    spam_action_repetition: 'delete',
    spam_volume_limit_60s: 10,
    spam_volume_limit_10s: 5,
    spam_duplicate_limit: 3,
    ai_enabled: false,
    ai_confidence_threshold: 0.75,
    keyword_sync_global: false,
    lang_enabled: false,
    allowed_languages: '["en"]',
    lang_action: 'delete',
    lang_min_chars: 20,
    lang_confidence_threshold: 0.8,
    lang_tier_bypass: 2,
    link_enabled: false,
    link_action_unknown: 'report_only',
    link_sync_global: false,
    link_tier_bypass: 2,
    nsfw_enabled: false,
    nsfw_action: 'delete',
    nsfw_threshold: 0.7,
    nsfw_blocked_categories: '["real_nudity","real_sex","hentai","gore","minors"]',
    modal_enabled: false,
    modal_action: 'report_only',
    casban_enabled: false,
    voteban_enabled: false,
    voteban_threshold: 5,
    voteban_duration_minutes: 30,
    welcome_enabled: false,
    captcha_enabled: false,
    ui_language: 'en'
};

/**
 * Mock query function
 */
async function query(sql, params = []) {
    return { rows: [], rowCount: 0 };
}

/**
 * Mock queryOne - returns first row or null
 */
async function queryOne(sql, params = []) {
    // Handle specific queries
    if (sql.includes('user_trust_flux')) {
        const key = `${params[0]}-${params[1]}`;
        return mockData.userTrustFlux.get(key) || null;
    }
    if (sql.includes('user_global_flux')) {
        return mockData.users.get(params[0]) || null;
    }
    if (sql.includes('guild_config')) {
        return mockData.guilds.get(params[0]) || { ...defaultGuildConfig, guild_id: params[0] };
    }
    if (sql.includes('cas_bans')) {
        return mockData.casBans.has(Number(params[0])) ? { user_id: params[0] } : null;
    }
    return null;
}

/**
 * Mock queryAll - returns all matching rows
 */
async function queryAll(sql, params = []) {
    if (sql.includes('word_filters')) {
        return mockData.wordFilters.filter(f =>
            f.guild_id === params[0] || f.guild_id === 0
        );
    }
    if (sql.includes('cas_bans')) {
        return Array.from(mockData.casBans).map(id => ({ user_id: id }));
    }
    if (sql.includes('link_rules')) {
        return mockData.linkRules;
    }
    if (sql.includes('spam_modals')) {
        return [];
    }
    if (sql.includes('intel_data')) {
        return [];
    }
    return [];
}

/**
 * Get guild config from cache
 */
function getGuildConfig(guildId) {
    return mockData.guilds.get(guildId) || { ...defaultGuildConfig, guild_id: guildId };
}

/**
 * Fetch guild config (async version)
 */
async function fetchGuildConfig(guildId) {
    return getGuildConfig(guildId);
}

/**
 * Reset all mock data
 */
function resetMockData() {
    mockData.guilds.clear();
    mockData.users.clear();
    mockData.wordFilters = [];
    mockData.linkRules = [];
    mockData.casBans.clear();
    mockData.activeVotes = [];
    mockData.userTrustFlux.clear();
}

/**
 * Set mock guild config
 */
function setGuildConfig(guildId, config) {
    mockData.guilds.set(guildId, { ...defaultGuildConfig, ...config, guild_id: guildId });
}

/**
 * Set mock user flux
 */
function setUserFlux(userId, guildId, flux) {
    mockData.userTrustFlux.set(`${userId}-${guildId}`, {
        user_id: userId,
        guild_id: guildId,
        local_flux: flux
    });
}

/**
 * Add word filter
 */
function addWordFilter(filter) {
    mockData.wordFilters.push({
        id: mockData.wordFilters.length + 1,
        guild_id: 0,
        word: '',
        is_regex: false,
        action: 'delete',
        category: 'custom',
        severity: 1,
        match_whole_word: false,
        bypass_tier: 2,
        ...filter
    });
}

/**
 * Add CAS ban
 */
function addCasBan(userId) {
    mockData.casBans.add(Number(userId));
}

/**
 * Add intel data (link rules)
 */
function addLinkRule(rule) {
    mockData.linkRules.push({
        id: mockData.linkRules.length + 1,
        guild_id: 0,
        pattern: '',
        type: 'whitelist_domain',
        action: 'delete',
        ...rule
    });
}

module.exports = {
    query,
    queryOne,
    queryAll,
    getGuildConfig,
    fetchGuildConfig,
    // Test helpers
    resetMockData,
    setGuildConfig,
    setUserFlux,
    addWordFilter,
    addCasBan,
    addLinkRule,
    mockData,
    defaultGuildConfig
};
