import { collection, doc, onSnapshot, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

const videosCol = collection(db, 'videos');

export const subscribeVideos = (onData, onError) =>
  onSnapshot(
    videosCol,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      onData(items);
    },
    onError,
  );

export const updateVideoStatus = (id, status) => updateDoc(doc(db, 'videos', id), { status });

// Einmaliger Import aus dem Google Sheet (ueberschreibt Dokumente mit gleicher ID)
export const importVideos = async (items) => {
  const batch = writeBatch(db);
  items.forEach((item) => {
    const { rowIndex, videoId, format, title, status, scriptLink, notes } = item;
    batch.set(doc(db, 'videos', `row-${rowIndex}`), {
      order: rowIndex,
      videoId,
      format,
      title,
      status,
      scriptLink,
      notes,
    });
  });
  await batch.commit();
};
