
// Simulation of the seeding logic changes
const groupCount = 4;
const entries = [];

// Create mock entries for 4 groups, 2 players each (since we care about rank 1 & 2)
for (let g = 1; g <= groupCount; g++) {
    entries.push({ name: `G${g}-1st`, group: g, points: 10, internalRank: 1 });
    entries.push({ name: `G${g}-2nd`, group: g, points: 8, internalRank: 2 });
}

// Mock normalization (already done in entries)
const normalizeTournamentRanks = (e) => e;

// The Modified makeSeedList Function
function makeSeedList(entries, groupCount) {
    const normalized = normalizeTournamentRanks(entries);

    const byRank = new Map();
    for (const q of normalized) {
        if (!byRank.has(q.internalRank)) byRank.set(q.internalRank, []);
        byRank.get(q.internalRank).push(q);
    }

    const ranks = Array.from(byRank.keys()).sort((a, b) => a - b);
    const seedList = [];

    for (const r of ranks) {
        const arr = byRank.get(r);

        let groupOrder;
        // The Logic I just added:
        if (r === 2 && groupCount === 4) {
            groupOrder = [2, 1, 4, 3];
        } else {
            groupOrder = Array.from({ length: groupCount }, (_, i) => i + 1);
        }

        const byGroup = new Map(arr.map(x => [x.group, x]));
        for (const g of groupOrder) {
            if (byGroup.has(g)) seedList.push(byGroup.get(g));
        }
    }
    return seedList.map((x, i) => ({ ...x, seed: i + 1 }));
}

const SEED_POSITIONS = {
    8: [1, 8, 4, 5, 3, 6, 2, 7]
};

function seedToSlots(seedList, B) {
    const pos = SEED_POSITIONS[B];
    const seedMap = new Map(seedList.map(s => [s.seed, s]));
    return pos.map(seedNum => seedMap.get(seedNum) || null);
}

// Run Simulation
const seeds = makeSeedList(entries, 4);
const slots = seedToSlots(seeds, 8); // 8-man bracket

console.log("--- Seeding Results ---");
seeds.forEach(s => console.log(`Seed ${s.seed}: ${s.name}`));

console.log("\n--- Bracket Matchups (Round 1) ---");
const pairs = [];
for (let i = 0; i < slots.length; i += 2) {
    console.log(`Match ${i / 2 + 1}: ${slots[i].name} vs ${slots[i + 1].name}`);
    pairs.push([slots[i], slots[i + 1]]);
}

console.log("\n--- Verification ---");
// Check separation
// Top Half: Match 1 & 2 -> Semi A
// Bot Half: Match 3 & 4 -> Semi B
const topHalf = [slots[0], slots[1], slots[2], slots[3]];
const botHalf = [slots[4], slots[5], slots[6], slots[7]];

const topGroups = topHalf.map(p => p.group);
const botGroups = botHalf.map(p => p.group);

console.log("Top Half Groups:", topGroups);
console.log("Bot Half Groups:", botGroups);

let success = true;
for (let g = 1; g <= 4; g++) {
    const inTop = topGroups.filter(x => x === g).length;
    const inBot = botGroups.filter(x => x === g).length;

    if (inTop === 1 && inBot === 1) {
        console.log(`Group ${g}: Separated perfectly (1 Top, 1 Bot).`);
        // Additional check: They shouldn't meet in Semis.
        // Match 1 (G1, G3) vs Match 2 (G4, G2) -> Semi A
        // Match 3 (G3, G1) vs Match 4 (G2, G4) -> Semi B
        // Wait, looking at the seeds:
        // Match 1: Seed 1 (G1) vs Seed 8 (G3)
        // Match 2: Seed 4 (G4) vs Seed 5 (G2)
        // Match 3: Seed 3 (G3) vs Seed 6 (G1)
        // Match 4: Seed 2 (G2) vs Seed 7 (G4)

        // G1 is in Match 1 (Semi A) and Match 3 (Semi B). SEPARATED until Final!
        // G2 is in Match 2 (Semi A) and Match 4 (Semi B). SEPARATED until Final!
        // G3 is in Match 1 (Semi A) and Match 3 (Semi B). SEPARATED until Final!
        // G4 is in Match 2 (Semi A) and Match 4 (Semi B). SEPARATED until Final!
    } else {
        console.error(`Group ${g}: FAILED Separation (Top: ${inTop}, Bot: ${inBot})`);
        success = false;
    }
}

if (success) console.log("\n✅ ALL CHECKS PASSED. Logic is correct.");
else console.log("\n❌ CHECKS FAILED.");
