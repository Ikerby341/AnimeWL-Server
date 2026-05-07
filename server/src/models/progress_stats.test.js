import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateTotalChapters,
    calculateTotalMinutes,
    countFinishedAnimes,
    sumChapterMinutes
} from './progress_stats.js';

test('sumChapterMinutes suma solo los capitulos vistos', () => {
    const chapterRows = [
        { duracio_minuts: 24 },
        { duracio_minuts: 24 },
        { duracio_minuts: 50 }
    ];

    assert.equal(sumChapterMinutes(chapterRows, 2), 48);
});

test('sumChapterMinutes ignora duraciones no numericas', () => {
    const chapterRows = [
        { duracio_minuts: 24 },
        { duracio_minuts: null },
        { duracio_minuts: '25' }
    ];

    assert.equal(sumChapterMinutes(chapterRows, 3), 49);
});

test('calculateTotalMinutes suma minuts_totals del progreso', () => {
    const progressRows = [
        { minuts_totals: 48 },
        { minuts_totals: 120 },
        { minuts_totals: 0 }
    ];

    assert.equal(calculateTotalMinutes(progressRows), 168);
});

test('calculateTotalChapters suma capitols_vistos del progreso', () => {
    const progressRows = [
        { capitols_vistos: 2 },
        { capitols_vistos: 12 },
        { capitols_vistos: 0 }
    ];

    assert.equal(calculateTotalChapters(progressRows), 14);
});

test('countFinishedAnimes cuenta solo animes completos', () => {
    const progressRows = [
        { id_anime: 'a', capitols_vistos: 12 },
        { id_anime: 'b', capitols_vistos: 11 },
        { id_anime: 'c', capitols_vistos: 1 }
    ];
    const episodeCounts = {
        a: 12,
        b: 24,
        c: 0
    };

    assert.equal(countFinishedAnimes(progressRows, episodeCounts), 1);
});
