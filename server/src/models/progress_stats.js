function sumarMinutsCapitols(chapterRows = [], chaptersWatched = 0) {
  const watchedCount = Number(chaptersWatched);

  if (!Number.isFinite(watchedCount) || watchedCount <= 0) {
    return 0;
  }

  return (chapterRows || []).
  slice(0, watchedCount).
  reduce((sum, row) => {
    const minutes = Number(row?.duracio_minuts);
    return sum + (Number.isFinite(minutes) ? minutes : 0);
  }, 0);
}export { sumarMinutsCapitols };

function calcularMinutsTotals(progressRows = []) {
  return (progressRows || []).reduce(
    (sum, row) => sum + Number(row?.minuts_totals || 0),
    0
  );
}export { calcularMinutsTotals };

function calcularCapitolsTotals(progressRows = []) {
  return (progressRows || []).reduce(
    (sum, row) => sum + Number(row?.capitols_vistos || 0),
    0
  );
}export { calcularCapitolsTotals };

function comptarAnimesAcabats(progressRows = [], episodeCounts = {}) {
  return (progressRows || []).reduce((count, row) => {
    const animeId = String(row?.id_anime);
    const chapterCount = Number(episodeCounts?.[animeId] || 0);
    const watchedChapters = Number(row?.capitols_vistos || 0);

    return count + (chapterCount > 0 && watchedChapters >= chapterCount ? 1 : 0);
  }, 0);
}export { comptarAnimesAcabats };