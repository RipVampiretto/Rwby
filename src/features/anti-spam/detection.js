function checkSpamLimits(stats, config) {
    const sensitivity = config.spam_sensitivity || 'medium';
    let limit10s = 5,
        limit60s = 10,
        limitDup = 3;

    if (sensitivity === 'high') {
        limit10s = 3;
        limit60s = 5;
        limitDup = 2;
    }
    if (sensitivity === 'low') {
        limit10s = 8;
        limit60s = 15;
        limitDup = 5;
    }

    // Override if in DB custom
    if (config.spam_volume_limit_10s) limit10s = config.spam_volume_limit_10s;
    if (config.spam_volume_limit_60s) limit60s = config.spam_volume_limit_60s;
    if (config.spam_duplicate_limit) limitDup = config.spam_duplicate_limit;

    let trigger = null;
    let action = 'delete';

    if (stats.msg_count_10s > limit10s) {
        trigger = `Burst (${stats.msg_count_10s}/${limit10s})`;
        action = config.spam_action_volume || 'delete';
    } else if (stats.msg_count_60s > limit60s) {
        trigger = `Flood (${stats.msg_count_60s}/${limit60s})`;
        action = config.spam_action_volume || 'delete';
    } else if (stats.duplicate_count >= limitDup) {
        trigger = `Repetition (${stats.duplicate_count}/${limitDup})`;
        action = config.spam_action_repetition || 'delete';
    }

    if (trigger) {
        return { triggered: true, trigger, action };
    }
    return { triggered: false };
}

module.exports = {
    checkSpamLimits
};
