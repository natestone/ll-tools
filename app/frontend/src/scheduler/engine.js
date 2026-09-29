// Pure scheduling engine extracted byte-for-byte from public/scheduler.html.
// No DOM access, no fetch — safe to import into React. Do NOT alter the
// algorithm logic here.

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Check if a date is weekend
function isWeekend(date) {
    return date.getDay() === 0 || date.getDay() === 6;
}

// Get all weeks between start and end dates
function getWeeks(start, end) {
    const weeks = [];
    const startDate = new Date(start);
    const endDate = new Date(end);

    // Anchor weeks to the Sunday on/before the season start, so every week
    // runs Sunday–Saturday regardless of which weekday the season begins on.
    const cursor = new Date(startDate);
    cursor.setDate(cursor.getDate() - cursor.getDay()); // back up to Sunday

    while (cursor <= endDate) {
        const sunday = new Date(cursor);
        const saturday = new Date(cursor);
        saturday.setDate(saturday.getDate() + 6);

        // Clamp the playable span to the season window so no game is ever
        // scheduled before the start date or after the end date.
        const playStart = sunday < startDate ? new Date(startDate) : new Date(sunday);
        const playEnd = saturday > endDate ? new Date(endDate) : new Date(saturday);

        // Fraction of the full 7-day week that is actually inside the season.
        // Used to pro-rate games-per-week targets for partial first/last weeks.
        const dayMs = 24 * 60 * 60 * 1000;
        const playableDays = Math.round((playEnd - playStart) / dayMs) + 1;
        const fraction = Math.max(0, Math.min(1, playableDays / 7));

        weeks.push({
            start: playStart,      // first schedulable date this week
            end: playEnd,          // last schedulable date this week
            weekStart: sunday,     // calendar Sunday (for display)
            weekEnd: saturday,     // calendar Saturday (for display)
            fraction: fraction
        });

        cursor.setDate(cursor.getDate() + 7);
    }

    return weeks;
}

// Get all dates within a week
function getDatesInWeek(weekStart, weekEnd) {
    const dates = [];
    const current = new Date(weekStart);

    while (current <= weekEnd) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

// Format date for display
function formatDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Shuffle an array randomly
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Track field usage per day with time slots
function initializeFieldUsage(fieldAvailability, startDate, endDate) {
    const fieldUsage = {};
    const currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    while (currentDate <= endDateObj) {
        const dateStr = currentDate.toISOString().split('T')[0];

        fieldUsage[dateStr] = {};

        // Initialize each field with available time slots for this day
        for (const field in fieldAvailability) {
            const timeSlots = fieldAvailability[field].timeSlots;

            fieldUsage[dateStr][field] = {
                timeSlots: {}
            };

            // Initialize each time slot with 1 game available
            timeSlots.forEach(slot => {
                fieldUsage[dateStr][field].timeSlots[slot] = 1;
            });
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return fieldUsage;
}

// Check if team prefers this day off
function teamPrefersOff(team, dayOfWeek, teamDaysOff) {
    return teamDaysOff[team] && teamDaysOff[team].includes(dayOfWeek);
}

// Create the weekly schedule with round-robin + additional games
function createWeeklySchedule(teams, startDate, endDate, fieldAvailability, teamHomeFields, teamDaysOff, teamDivisions, teamCrossDivisions, teamGamesPerWeek) {
    teamCrossDivisions = teamCrossDivisions || {};
    teamGamesPerWeek = teamGamesPerWeek || {};
    const weeks = getWeeks(startDate, endDate);
    const schedule = [];
    const unscheduledGames = [];
    const violatedPreferences = [];

    // Initialize field usage tracking with time slots
    const fieldUsage = initializeFieldUsage(fieldAvailability, startDate, endDate);

    // Group teams by division
    const teamsByDivision = {};
    teams.forEach(team => {
        const division = teamDivisions[team];
        if (!teamsByDivision[division]) {
            teamsByDivision[division] = [];
        }
        teamsByDivision[division].push(team);
    });

    // Create round-robin matchups for each division
    const divisionMatchups = {};
    let totalPossibleGames = 0;

    for (const division in teamsByDivision) {
        const divisionTeams = teamsByDivision[division];
        divisionMatchups[division] = [];

        // Create round-robin matchups within this division
        for (let i = 0; i < divisionTeams.length; i++) {
            for (let j = i + 1; j < divisionTeams.length; j++) {
                divisionMatchups[division].push([divisionTeams[i], divisionTeams[j]]);
                totalPossibleGames++;
            }
        }
    }

    // Create inter-division (cross-play) matchups.
    // A pair from two different divisions is included when at least one of the
    // two teams has opted into playing the other team's division.
    const CROSS_KEY = '__CROSS__';
    divisionMatchups[CROSS_KEY] = [];
    for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
            const a = teams[i];
            const b = teams[j];
            const divA = teamDivisions[a];
            const divB = teamDivisions[b];
            if (divA === divB) continue; // same division handled above

            const aWantsB = (teamCrossDivisions[a] || []).includes(divB);
            const bWantsA = (teamCrossDivisions[b] || []).includes(divA);
            if (aWantsB || bWantsA) {
                divisionMatchups[CROSS_KEY].push([a, b]);
                totalPossibleGames++;
            }
        }
    }
    if (divisionMatchups[CROSS_KEY].length === 0) {
        delete divisionMatchups[CROSS_KEY];
    }

    // Initialize team statistics
    const teamStats = {};
    teams.forEach(team => {
        teamStats[team] = {
            homeGames: 0,
            awayGames: 0,
            weekdayGames: 0,
            weekendGames: 0,
            totalGames: 0,
            opponents: new Set(),
            homeField: teamHomeFields[team] || null,
            daysOff: teamDaysOff[team] || [],
            violatedPreferences: 0,
            division: teamDivisions[team],
            crossDivisions: teamCrossDivisions[team] || [],
            gamesPerWeekTarget: teamGamesPerWeek[team] || 2,
            gamesThisWeek: 0
        };
    });

    // (Matchups are drawn from divisionMatchups directly in the unified
    // scheduling pass below; no separate per-division consumable pool is needed.)

    // Reset weekly counters and set each team's EFFECTIVE target for this week.
    // For partial weeks (season starts/ends mid-week), the per-week target is
    // pro-rated by the fraction of the week that falls inside the season, so a
    // short first week doesn't try to fit a full week's games into a few days.
    // We round (not ceil/floor) and keep a floor of 1 for any team that wants
    // games at all, so a team isn't shut out of a partial week entirely.
    function resetWeeklyCounters(fraction) {
        const f = (typeof fraction === 'number') ? fraction : 1;
        teams.forEach(team => {
            teamStats[team].gamesThisWeek = 0;
            const full = teamStats[team].gamesPerWeekTarget;
            let eff = Math.round(full * f);
            if (full > 0 && eff < 1 && f > 0) eff = 1;
            teamStats[team].weeklyTargetThisWeek = eff;
        });
    }

    // True when every team has reached this week's (possibly pro-rated) target.
    function allTeamsAtWeeklyTarget() {
        return teams.every(t => teamStats[t].gamesThisWeek >= teamStats[t].weeklyTargetThisWeek);
    }

    // Order a week's dates so games spread out: weekend day(s) plus weekdays,
    // starting mid-week and alternating outward, so multiple game days per week
    // are used when teams want more than one or two games.
    function orderWeekDates(weekDates) {
        const weekdays = weekDates.filter(d => !isWeekend(d));
        const weekends = weekDates.filter(d => isWeekend(d));

        // Spread weekdays from the middle outward (Wed, then Tue/Thu, then Mon/Fri...)
        const orderedWeekdays = [];
        if (weekdays.length > 0) {
            const mid = Math.floor(weekdays.length / 2);
            orderedWeekdays.push(weekdays[mid]);
            let offset = 1;
            while (orderedWeekdays.length < weekdays.length) {
                if (mid - offset >= 0) orderedWeekdays.push(weekdays[mid - offset]);
                if (mid + offset < weekdays.length) orderedWeekdays.push(weekdays[mid + offset]);
                offset++;
            }
        }

        // Interleave: weekday, weekend, weekday, weekend, ... then any leftovers
        const ordered = [];
        const maxLen = Math.max(orderedWeekdays.length, weekends.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < orderedWeekdays.length) ordered.push(orderedWeekdays[i]);
            if (i < weekends.length) ordered.push(weekends[i]);
        }
        return ordered;
    }

    // Schedule one week across as many game days as needed to approach each team's
    // weekly target. getMatchups() returns the current pool; onScheduled(game)
    // records the game and removes the used matchup from its pool.
    function scheduleWeekAcrossDays(weekDates, getMatchups, onScheduled) {
        const orderedDates = orderWeekDates(weekDates);

        for (const date of orderedDates) {
            if (allTeamsAtWeeklyTarget()) break;

            let pool = shuffleArray([...getMatchups()]);
            if (pool.length === 0) break;

            const dayGames = scheduleWeeklyGames(
                pool,
                date,
                isWeekend(date),
                teamStats,
                teams,
                fieldAvailability,
                fieldUsage,
                teamHomeFields,
                teamDaysOff,
                violatedPreferences
            );

            dayGames.forEach(game => onScheduled(game));
        }
    }

    let weekIndex = 0;

    // Build the universe of all valid pairings (within-division + opted-in
    // cross-division). These are the matchups that may be REPEATED to help
    // teams reach their games-per-week target when unique matchups run out
    // or are blocked by day-off / field constraints.
    const allValidPairings = [];
    for (const bucket in divisionMatchups) {
        divisionMatchups[bucket].forEach(pair => allValidPairings.push([pair[0], pair[1]]));
    }

    const pairKey = (a, b) => [a, b].sort().join('|||');
    const playedPairings = new Set();      // pairings already used at least once
    const gamesByPairing = {};             // how many times each pairing has been scheduled

    const recordGame = (game) => {
        schedule.push(game);
        const k = pairKey(game.homeTeam, game.awayTeam);
        playedPairings.add(k);
        gamesByPairing[k] = (gamesByPairing[k] || 0) + 1;
    };

    // Unified pass over every week, using a TWO-TIER fill so that diversity
    // is maximized before any repeat is considered:
    //
    //   Tier 1 (diversity): across the whole week, offer ONLY pairings that
    //     have never been played. Every team meets as many NEW opponents as
    //     the calendar/day-off/field constraints allow.
    //
    //   Tier 2 (repeats): only after new matchups for the week are exhausted,
    //     sweep the same week again allowing repeats — but only for pairings
    //     where at least one team is still UNDER its weekly target. Teams that
    //     already hit their target contribute nothing here, so they never get
    //     a gratuitous repeat. Repeats prefer the least-played pairing so they
    //     stay spread out.
    //
    // scheduleWeeklyGames still enforces the weekly target, one game per team
    // per day, day-off, and field availability in both tiers.
    while (weekIndex < weeks.length) {
        const week = weeks[weekIndex];
        const weekDates = getDatesInWeek(week.start, week.end);

        resetWeeklyCounters(week.fraction);

        // Tier 1: new matchups only (maximize opponent diversity)
        scheduleWeekAcrossDays(
            weekDates,
            () => {
                const needy = new Set(
                    teams.filter(t => teamStats[t].gamesThisWeek < teamStats[t].weeklyTargetThisWeek)
                );
                if (needy.size === 0) return [];
                // Only pairings never played, and only if useful to a needy team
                const fresh = allValidPairings.filter(([a, b]) =>
                    !playedPairings.has(pairKey(a, b)) && (needy.has(a) || needy.has(b))
                );
                return shuffleArray(fresh);
            },
            recordGame
        );

        // Tier 2: allow repeats, but only for teams still short of target
        scheduleWeekAcrossDays(
            weekDates,
            () => {
                const needy = new Set(
                    teams.filter(t => teamStats[t].gamesThisWeek < teamStats[t].weeklyTargetThisWeek)
                );
                if (needy.size === 0) return [];
                // Any valid pairing useful to a needy team (repeats included),
                // least-played first so repeats are spread across opponents.
                const useful = allValidPairings.filter(([a, b]) => needy.has(a) || needy.has(b));
                useful.sort((x, y) =>
                    (gamesByPairing[pairKey(x[0], x[1])] || 0) -
                    (gamesByPairing[pairKey(y[0], y[1])] || 0)
                );
                return useful;
            },
            recordGame
        );

        weekIndex++;
    }

    // Any pairing never played at all is reported as unscheduled (informational).
    allValidPairings.forEach(([a, b]) => {
        if (!playedPairings.has(pairKey(a, b))) {
            unscheduledGames.push([a, b]);
        }
    });

    schedule.sort((a, b) => {
        if (a.date.getTime() === b.date.getTime()) {
            return a.timeSlot.localeCompare(b.timeSlot);
        }
        return a.date - b.date;
    });

    return {
        schedule,
        teamStats,
        unscheduledGames,
        violatedPreferences,
        schedulingComplete: unscheduledGames.length === 0,
        totalPossibleGames: totalPossibleGames,
        seasonStart: new Date(startDate),
        weeks: weeks.length,
        teams: teams,
        fieldUsage: fieldUsage,
        divisions: Object.keys(teamsByDivision),
        teamsByDivision: teamsByDivision
    };
}

// Schedule games for a specific date with time slots
function scheduleWeeklyGames(availableMatchups, date, isWeekendDate, teamStats, teams, fieldAvailability, fieldUsage, teamHomeFields, teamDaysOff, violatedPreferences) {
    const gamesThisDate = [];
    const teamsUsedToday = new Set();
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();

    const maxRegularGames = Math.floor(teams.length / 2);
    let targetGames = maxRegularGames;

    // If odd number of teams, need one extra game
    if (teams.length % 2 === 1) {
        targetGames = maxRegularGames + 1;
    }

    let gamesScheduled = 0;

    // Days-off is a hard constraint: a matchup is only eligible on a given day
    // if NEITHER team marked that day off. Ineligible matchups are simply not
    // scheduled today; they remain in the pool for a day that works for both.
    const orderedMatchups = [];
    for (const matchup of availableMatchups) {
        const [team1, team2] = matchup;
        const team1PrefersOff = teamPrefersOff(team1, dayOfWeek, teamDaysOff);
        const team2PrefersOff = teamPrefersOff(team2, dayOfWeek, teamDaysOff);
        if (!team1PrefersOff && !team2PrefersOff) {
            orderedMatchups.push(matchup);
        }
    }

    // Schedule regular games with unique teams
    for (const matchup of orderedMatchups) {
        if (gamesScheduled >= maxRegularGames) break;

        const [team1, team2] = matchup;

        // Respect each team's target games-per-week
        const team1AtTarget = teamStats[team1].gamesThisWeek >= teamStats[team1].weeklyTargetThisWeek;
        const team2AtTarget = teamStats[team2].gamesThisWeek >= teamStats[team2].weeklyTargetThisWeek;
        if (team1AtTarget || team2AtTarget) continue;

        if (!teamsUsedToday.has(team1) && !teamsUsedToday.has(team2)) {
            // Day-off is enforced as a hard constraint above, so an eligible
            // matchup never violates a preference.
            const violatesPreference = false;

            // Determine home team based on balance of home/away games
            let homeTeam = null;
            let awayTeam = null;
            let fieldToUse = null;
            let timeSlotToUse = null;

            // Calculate which team should be home based on current home/away balance
            const team1HomeRatio = teamStats[team1].totalGames > 0 ?
                teamStats[team1].homeGames / teamStats[team1].totalGames : 0.5;
            const team2HomeRatio = teamStats[team2].totalGames > 0 ?
                teamStats[team2].homeGames / teamStats[team2].totalGames : 0.5;

            // Prefer the team with fewer home games to be home
            let preferredHome = team1HomeRatio < team2HomeRatio ? team1 : team2;
            let preferredAway = preferredHome === team1 ? team2 : team1;

            // Try to use preferred home team's field first
            if (teamHomeFields[preferredHome] && fieldUsage[dateStr][teamHomeFields[preferredHome]]) {
                const availableSlots = Object.entries(fieldUsage[dateStr][teamHomeFields[preferredHome]].timeSlots)
                    .filter(([time, count]) => count > 0);

                if (availableSlots.length > 0) {
                    homeTeam = preferredHome;
                    awayTeam = preferredAway;
                    fieldToUse = teamHomeFields[preferredHome];
                    timeSlotToUse = availableSlots[0][0];
                }
            }

            // If preferred setup doesn't work, try the reverse
            if (!fieldToUse && teamHomeFields[preferredAway] && fieldUsage[dateStr][teamHomeFields[preferredAway]]) {
                const availableSlots = Object.entries(fieldUsage[dateStr][teamHomeFields[preferredAway]].timeSlots)
                    .filter(([time, count]) => count > 0);

                if (availableSlots.length > 0) {
                    homeTeam = preferredAway;
                    awayTeam = preferredHome;
                    fieldToUse = teamHomeFields[preferredAway];
                    timeSlotToUse = availableSlots[0][0];
                }
            }

            // If neither team's home field is available, find any available field
            if (!fieldToUse) {
                // Still use the preferred home/away assignment
                homeTeam = preferredHome;
                awayTeam = preferredAway;

                // Find any available field and time slot
                for (const field in fieldUsage[dateStr]) {
                    const availableSlots = Object.entries(fieldUsage[dateStr][field].timeSlots)
                        .filter(([time, count]) => count > 0);

                    if (availableSlots.length > 0) {
                        fieldToUse = field;
                        timeSlotToUse = availableSlots[0][0];
                        break;
                    }
                }
            }

            // Skip if no field available
            if (!fieldToUse || !timeSlotToUse) continue;

            const game = {
                date: new Date(date),
                homeTeam: homeTeam,
                awayTeam: awayTeam,
                isWeekend: isWeekendDate,
                field: fieldToUse,
                timeSlot: timeSlotToUse,
                violatesPreference: violatesPreference
            };

            // Decrement available slots for this field and time
            fieldUsage[dateStr][fieldToUse].timeSlots[timeSlotToUse]--;

            gamesThisDate.push(game);

            // Update team statistics
            teamStats[homeTeam].homeGames++;
            teamStats[homeTeam].totalGames++;
            teamStats[homeTeam].opponents.add(awayTeam);
            if (violatesPreference && teamPrefersOff(homeTeam, dayOfWeek, teamDaysOff)) {
                teamStats[homeTeam].violatedPreferences++;
                violatedPreferences.push({
                    team: homeTeam,
                    date: formatDate(date),
                    dayOfWeek: dayNames[dayOfWeek]
                });
            }

            teamStats[awayTeam].awayGames++;
            teamStats[awayTeam].totalGames++;
            teamStats[awayTeam].opponents.add(homeTeam);
            if (violatesPreference && teamPrefersOff(awayTeam, dayOfWeek, teamDaysOff)) {
                teamStats[awayTeam].violatedPreferences++;
                violatedPreferences.push({
                    team: awayTeam,
                    date: formatDate(date),
                    dayOfWeek: dayNames[dayOfWeek]
                });
            }

            if (isWeekendDate) {
                teamStats[homeTeam].weekendGames++;
                teamStats[awayTeam].weekendGames++;
            } else {
                teamStats[homeTeam].weekdayGames++;
                teamStats[awayTeam].weekdayGames++;
            }

            teamsUsedToday.add(team1);
            teamsUsedToday.add(team2);
            teamStats[homeTeam].gamesThisWeek++;
            teamStats[awayTeam].gamesThisWeek++;
            gamesScheduled++;
        }
    }

    // Handle odd team out
    if (teams.length % 2 === 1 && gamesScheduled < targetGames) {
        // Only consider left-out teams that are still UNDER their weekly target.
        // (Previously this ignored the left-out team's own target, which let an
        // odd team get force-scheduled every day and blow past its games/week.)
        const teamsNotPlaying = teams.filter(team =>
            !teamsUsedToday.has(team) &&
            teamStats[team].gamesThisWeek < teamStats[team].weeklyTargetThisWeek
        );

        if (teamsNotPlaying.length > 0) {
            const leftOutTeam = teamsNotPlaying[0];

            // Find a matchup involving the left-out team
            for (const matchup of orderedMatchups) {
                if (gamesScheduled >= targetGames) break;

                const [team1, team2] = matchup;

                if (team1 === leftOutTeam || team2 === leftOutTeam) {
                    const otherTeam = team1 === leftOutTeam ? team2 : team1;

                    // Skip if other team already playing today
                    if (teamsUsedToday.has(otherTeam)) continue;
                    // Respect the other team's weekly target (the left-out team is prioritized)
                    if (teamStats[otherTeam].gamesThisWeek >= teamStats[otherTeam].weeklyTargetThisWeek) continue;

                    // orderedMatchups only contains day-eligible pairings, so
                    // this game never violates a day-off preference.
                    const violatesPreference = false;

                    // Determine home team and field based on balance
                    let homeTeam = null;
                    let awayTeam = null;
                    let fieldToUse = null;
                    let timeSlotToUse = null;

                    // Calculate which team should be home based on current home/away balance
                    const leftOutHomeRatio = teamStats[leftOutTeam].totalGames > 0 ?
                        teamStats[leftOutTeam].homeGames / teamStats[leftOutTeam].totalGames : 0.5;
                    const otherHomeRatio = teamStats[otherTeam].totalGames > 0 ?
                        teamStats[otherTeam].homeGames / teamStats[otherTeam].totalGames : 0.5;

                    // Prefer the team with fewer home games to be home
                    let preferredHome = leftOutHomeRatio < otherHomeRatio ? leftOutTeam : otherTeam;
                    let preferredAway = preferredHome === leftOutTeam ? otherTeam : leftOutTeam;

                    // Try to use preferred home team's field first
                    if (teamHomeFields[preferredHome] && fieldUsage[dateStr][teamHomeFields[preferredHome]]) {
                        const availableSlots = Object.entries(fieldUsage[dateStr][teamHomeFields[preferredHome]].timeSlots)
                            .filter(([time, count]) => count > 0);

                        if (availableSlots.length > 0) {
                            homeTeam = preferredHome;
                            awayTeam = preferredAway;
                            fieldToUse = teamHomeFields[preferredHome];
                            timeSlotToUse = availableSlots[0][0];
                        }
                    }

                    // If preferred setup doesn't work, try the reverse
                    if (!fieldToUse && teamHomeFields[preferredAway] && fieldUsage[dateStr][teamHomeFields[preferredAway]]) {
                        const availableSlots = Object.entries(fieldUsage[dateStr][teamHomeFields[preferredAway]].timeSlots)
                            .filter(([time, count]) => count > 0);

                        if (availableSlots.length > 0) {
                            homeTeam = preferredAway;
                            awayTeam = preferredHome;
                            fieldToUse = teamHomeFields[preferredAway];
                            timeSlotToUse = availableSlots[0][0];
                        }
                    }

                    // If neither team's home field is available, find any available field
                    if (!fieldToUse) {
                        // Still use the preferred home/away assignment
                        homeTeam = preferredHome;
                        awayTeam = preferredAway;

                        for (const field in fieldUsage[dateStr]) {
                            const availableSlots = Object.entries(fieldUsage[dateStr][field].timeSlots)
                                .filter(([time, count]) => count > 0);

                            if (availableSlots.length > 0) {
                                fieldToUse = field;
                                timeSlotToUse = availableSlots[0][0];
                                break;
                            }
                        }
                    }

                    // Skip if no field available
                    if (!fieldToUse || !timeSlotToUse) continue;

                    const game = {
                        date: new Date(date),
                        homeTeam: homeTeam,
                        awayTeam: awayTeam,
                        isWeekend: isWeekendDate,
                        field: fieldToUse,
                        timeSlot: timeSlotToUse,
                        violatesPreference: violatesPreference
                    };

                    // Decrement available slots for this field and time
                    fieldUsage[dateStr][fieldToUse].timeSlots[timeSlotToUse]--;

                    gamesThisDate.push(game);

                    // Update team statistics
                    teamStats[homeTeam].homeGames++;
                    teamStats[homeTeam].totalGames++;
                    teamStats[homeTeam].opponents.add(awayTeam);
                    if (violatesPreference && teamPrefersOff(homeTeam, dayOfWeek, teamDaysOff)) {
                        teamStats[homeTeam].violatedPreferences++;
                        violatedPreferences.push({
                            team: homeTeam,
                            date: formatDate(date),
                            dayOfWeek: dayNames[dayOfWeek]
                        });
                    }

                    teamStats[awayTeam].awayGames++;
                    teamStats[awayTeam].totalGames++;
                    teamStats[awayTeam].opponents.add(homeTeam);
                    if (violatesPreference && teamPrefersOff(awayTeam, dayOfWeek, teamDaysOff)) {
                        teamStats[awayTeam].violatedPreferences++;
                        violatedPreferences.push({
                            team: awayTeam,
                            date: formatDate(date),
                            dayOfWeek: dayNames[dayOfWeek]
                        });
                    }

                    if (isWeekendDate) {
                        teamStats[homeTeam].weekendGames++;
                        teamStats[awayTeam].weekendGames++;
                    } else {
                        teamStats[homeTeam].weekdayGames++;
                        teamStats[awayTeam].weekdayGames++;
                    }

                    gamesScheduled++;
                    teamStats[homeTeam].gamesThisWeek++;
                    teamStats[awayTeam].gamesThisWeek++;
                    break;
                }
            }
        }
    }

    // Sort games by time slot
    gamesThisDate.sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));

    return gamesThisDate;
}

// Get the start date of the week for a given date
function getWeekStartDate(date) {
    const result = new Date(date);
    const day = result.getDay();
    const diff = result.getDate() - day;
    result.setDate(diff);
    return result;
}

// Week index of a game relative to the Sunday on/before the season start,
// matching how the SCHEDULER now defines weeks (Sunday–Saturday calendar
// weeks). Keeps the displayed grouping consistent with the games-per-week
// logic, and labels each week by its real calendar Sun–Sat span.
function getSeasonWeekInfo(gameDate, seasonStart) {
    const toMidnight = (d) => {
        const x = new Date(d);
        return new Date(x.getFullYear(), x.getMonth(), x.getDate());
    };
    // Anchor: the Sunday on or before the season start.
    const anchor = toMidnight(seasonStart);
    anchor.setDate(anchor.getDate() - anchor.getDay());
    const g = toMidnight(gameDate);
    const dayMs = 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor((g - anchor) / (7 * dayMs));
    const weekStart = new Date(anchor);
    weekStart.setDate(anchor.getDate() + weekIndex * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { weekIndex, weekStart, weekEnd };
}

export { createWeeklySchedule, getSeasonWeekInfo, getWeekStartDate, formatDate };
