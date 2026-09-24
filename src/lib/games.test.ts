import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

async function seedFilterableGames(db: Database): Promise<void> {
    const [strategy] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'strategy' })
        .returning({ id: categories.id });
    const [puzzle] = await db
        .insert(categories)
        .values({ name: 'Puzzle', description: 'puzzle' })
        .returning({ id: categories.id });
    const [firstPublisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'first' })
        .returning({ id: publishers.id });
    const [secondPublisher] = await db
        .insert(publishers)
        .values({ name: 'Pub Two', description: 'second' })
        .returning({ id: publishers.id });

    await db.insert(games).values([
        {
            title: 'Alpha',
            description: 'Alpha',
            starRating: 4,
            categoryId: strategy.id,
            publisherId: firstPublisher.id,
        },
        {
            title: 'Beta',
            description: 'Beta',
            starRating: 4,
            categoryId: puzzle.id,
            publisherId: firstPublisher.id,
        },
        {
            title: 'Gamma',
            description: 'Gamma',
            starRating: 4,
            categoryId: strategy.id,
            publisherId: secondPublisher.id,
        },
    ]);
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });

    it('filters games by one or more categories', async () => {
        await seedFilterableGames(db);
        const strategy = await db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.name, 'Strategy'))
            .get();
        const puzzle = await db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.name, 'Puzzle'))
            .get();
        if (!strategy || !puzzle) {
            throw new Error('Expected filter categories to be seeded');
        }

        expect(
            (await getAllGames(db, { categoryIds: [strategy.id] })).map(
                (game) => game.title,
            ),
        ).toEqual(['Alpha', 'Gamma']);
        expect(
            (await getAllGames(db, { categoryIds: [strategy.id, puzzle.id] })).map(
                (game) => game.title,
            ),
        ).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('combines category and publisher filters', async () => {
        await seedFilterableGames(db);
        const strategy = await db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.name, 'Strategy'))
            .get();
        const publisher = await db
            .select({ id: publishers.id })
            .from(publishers)
            .where(eq(publishers.name, 'Pub Two'))
            .get();
        if (!strategy || !publisher) {
            throw new Error('Expected filter relations to be seeded');
        }

        const filtered = await getAllGames(db, {
            categoryIds: [strategy.id],
            publisherId: publisher.id,
        });

        expect(filtered.map((game) => game.title)).toEqual(['Gamma']);
    });

    it('returns no games for an unmatched filter and all games without filters', async () => {
        await seedFilterableGames(db);

        expect(
            await getAllGames(db, {
                publisherId: 99999,
            }),
        ).toEqual([]);
        expect((await getAllGames(db)).map((game) => game.title)).toEqual([
            'Alpha',
            'Beta',
            'Gamma',
        ]);
    });
});
