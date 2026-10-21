/**
 * Desk layout sizes shared by main (BrowserWindow minimum) and the renderer (grid columns).
 * Library sidebar | reader | splitter | chat. The sidebar is fixed-width when open and can collapse
 * to a 40px rail; it is not resizable. The window minimum is computed with the sidebar open, so at
 * the minimum size every column is at (at least) its minimum.
 */
export const LIBRARY_WIDTH = 240;
export const LIBRARY_COLLAPSED_WIDTH = 40;
export const READER_MIN = 360;
export const CHAT_MIN = 320;
export const CHAT_MAX = 640;
export const CHAT_DEFAULT = 400;
/** The reader | chat splitter column. */
export const SPLITTER_WIDTH = 4;
export const WINDOW_MIN_WIDTH = LIBRARY_WIDTH + READER_MIN + SPLITTER_WIDTH + CHAT_MIN;
export const WINDOW_MIN_HEIGHT = 600;
