// Every mp3 in assets/music becomes a soundtrack entry (see music.js).
export const MUSIC_FILES = import.meta.glob('../../assets/music/*.mp3', { eager: true, query: '?url', import: 'default' });
