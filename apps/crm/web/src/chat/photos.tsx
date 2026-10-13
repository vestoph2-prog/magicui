import {
  type ChangeEvent,
  type TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MAX_PHOTOS_PER_MESSAGE } from "../../../shared/model.ts";
import { uploadImage } from "../api.ts";
import { compressImage, uploadUrl } from "../image.ts";
import { alertMessage, haptic } from "../telegram.ts";

export type DraftPhoto = { id: number; blob: Blob; url: string };

let nextDraftId = 1;

/** Photos picked but not sent yet: compress on pick, upload on send. */
export const usePhotoDraft = () => {
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const latest = useRef(photos);
  latest.current = photos;

  // Free object URLs when the draft goes away.
  useEffect(
    () => () => {
      for (const p of latest.current) {
        URL.revokeObjectURL(p.url);
      }
    },
    []
  );

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    const room = MAX_PHOTOS_PER_MESSAGE - latest.current.length;
    if (images.length > room) {
      alertMessage(`Можно приложить не больше ${MAX_PHOTOS_PER_MESSAGE} фото`);
    }
    const accepted = images.slice(0, Math.max(0, room));
    if (!accepted.length) {
      return;
    }
    setPreparing(true);
    try {
      const blobs = await Promise.all(accepted.map(compressImage));
      const added = blobs.map((blob) => ({
        id: nextDraftId++,
        blob,
        url: URL.createObjectURL(blob),
      }));
      haptic.select();
      setPhotos((list) => [...list, ...added]);
    } finally {
      setPreparing(false);
    }
  }, []);

  const remove = useCallback((id: number) => {
    setPhotos((list) => {
      const gone = list.find((p) => p.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.url);
      }
      return list.filter((p) => p.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    for (const p of latest.current) {
      URL.revokeObjectURL(p.url);
    }
    setPhotos([]);
  }, []);

  /** Uploads in parallel and returns stored names in the original order. */
  const uploadAll = useCallback(
    () => Promise.all(latest.current.map((p) => uploadImage(p.blob))),
    []
  );

  return { photos, preparing, addFiles, remove, clear, uploadAll };
};

export type PhotoDraft = ReturnType<typeof usePhotoDraft>;

/** 📎 button + hidden multi-select input (camera or gallery on phones). */
export const AttachButton = ({
  draft,
  label = "📎",
  className = "icon-btn",
}: {
  draft: PhotoDraft;
  label?: string;
  className?: string;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    draft.addFiles(files).catch(() => null);
  };
  return (
    <>
      <button
        aria-label="Прикрепить фото"
        className={className}
        disabled={draft.preparing}
        onClick={() => input.current?.click()}
        type="button"
      >
        {draft.preparing ? "…" : label}
      </button>
      <input
        accept="image/*"
        hidden
        multiple
        onChange={onChange}
        ref={input}
        type="file"
      />
    </>
  );
};

export const DraftPreviews = ({ draft }: { draft: PhotoDraft }) =>
  draft.photos.length ? (
    <div className="draft-photos">
      {draft.photos.map((p) => (
        <div className="draft-photo" key={p.id}>
          <img alt="Фото к отправке" src={p.url} />
          <button
            aria-label="Убрать фото"
            onClick={() => draft.remove(p.id)}
            type="button"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  ) : null;

export const PhotoGrid = ({
  files,
  onOpen,
}: {
  files: string[];
  onOpen: (index: number) => void;
}) => (
  <div className={files.length === 1 ? "photo-grid single" : "photo-grid"}>
    {files.map((file, i) => (
      <button
        aria-label={`Открыть фото ${i + 1}`}
        key={file}
        onClick={() => onOpen(i)}
        type="button"
      >
        <img alt="" loading="lazy" src={uploadUrl(file)} />
      </button>
    ))}
  </div>
);

const SWIPE_PX = 50;

export const Lightbox = ({
  files,
  index,
  caption,
  onClose,
}: {
  files: string[];
  index: number;
  caption?: (index: number) => string;
  onClose: () => void;
}) => {
  const [current, setCurrent] = useState(index);
  const touchX = useRef<number | null>(null);
  const file = files[current];
  const step = (delta: number) =>
    setCurrent((i) => (i + delta + files.length) % files.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        setCurrent((i) => (i + 1) % files.length);
      } else if (e.key === "ArrowLeft") {
        setCurrent((i) => (i - 1 + files.length) % files.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length, onClose]);

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchX.current;
    const end = e.changedTouches[0]?.clientX;
    touchX.current = null;
    if (
      start !== null &&
      end !== undefined &&
      Math.abs(end - start) > SWIPE_PX
    ) {
      step(end < start ? 1 : -1);
    }
  };

  if (!file) {
    return null;
  }
  return (
    <div
      aria-label="Просмотр фото"
      aria-modal="true"
      className="lightbox"
      onTouchEnd={onTouchEnd}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      role="dialog"
    >
      <img alt="Фото" src={uploadUrl(file)} />
      <div className="lightbox-bar">
        <span>
          {files.length > 1 ? `${current + 1} / ${files.length}` : ""}
          {caption ? ` ${caption(current)}` : ""}
        </span>
        <span className="spacer" />
        <a
          className="lightbox-btn"
          download
          href={uploadUrl(file)}
          rel="noopener"
          target="_blank"
        >
          ⬇︎
        </a>
        <button
          aria-label="Закрыть"
          className="lightbox-btn"
          onClick={onClose}
          type="button"
        >
          ✕
        </button>
      </div>
      {files.length > 1 ? (
        <>
          <button
            aria-label="Предыдущее фото"
            className="lightbox-nav prev"
            onClick={() => step(-1)}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="Следующее фото"
            className="lightbox-nav next"
            onClick={() => step(1)}
            type="button"
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
};

/** Thumbnails grid with its own viewer — task header and object page. */
export const Gallery = ({
  files,
  limit,
  caption,
}: {
  files: string[];
  limit?: number;
  caption?: (index: number) => string;
}) => {
  const [viewer, setViewer] = useState<number | null>(null);
  const shown = limit ? files.slice(0, limit) : files;
  const hidden = files.length - shown.length;
  return (
    <>
      <div className="gallery">
        {shown.map((file, i) => (
          <button
            aria-label={`Открыть фото ${i + 1}`}
            key={file}
            onClick={() => setViewer(i)}
            type="button"
          >
            <img alt="" loading="lazy" src={uploadUrl(file)} />
            {hidden > 0 && i === shown.length - 1 ? (
              <span className="gallery-more">+{hidden}</span>
            ) : null}
          </button>
        ))}
      </div>
      {viewer === null ? null : (
        <Lightbox
          caption={caption}
          files={files}
          index={viewer}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
};
