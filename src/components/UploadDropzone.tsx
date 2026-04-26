import { useCallback, useState } from "react";
import { File as FileIcon, Upload, X } from "lucide-react";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

export function UploadDropzone({ files, onChange, disabled }: Props) {
  const [over, setOver] = useState(false);

  const accept = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming).filter((f) => f.size <= MAX_SIZE);
      const merged = [...files, ...list].slice(0, MAX_FILES);
      onChange(merged);
    },
    [files, onChange],
  );

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        if (e.dataTransfer.files) accept(e.dataTransfer.files);
      }}
      className={`block lab-card p-4 cursor-pointer transition-colors ${
        over ? "border-brass bg-primary-soft/40" : "hover:bg-card/60"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input
        type="file"
        multiple
        onChange={(e) => e.target.files && accept(e.target.files)}
        className="hidden"
        disabled={disabled}
      />
      <div className="flex items-center gap-3">
        <div className="grid place-items-center h-9 w-9 rounded-md bg-secondary text-foreground/70">
          <Upload className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            <span className="font-medium">Add reference material</span>{" "}
            <span className="text-muted-foreground">— optional</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Drop PDFs, papers, notes, datasets, images — any format. We'll parse them as initial context.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {files.length}/{MAX_FILES}
        </span>
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 text-xs text-foreground/80 bg-background/60 rounded px-2 py-1.5"
            >
              <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(files.filter((_, idx) => idx !== i));
                }}
                className="text-muted-foreground hover:text-foreground p-0.5"
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
