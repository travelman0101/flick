import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment } from "../../shared/types";
import { api, fileUrl, HttpError } from "../api";
import { compressImage, formatSize } from "../compress";
import { haptic } from "../format";
import { flush, setAttachmentCount } from "../store";
import { toast } from "../toast";
import { Close, FileIcon, Paperclip, Plus } from "./icons";
import { SkeletonRows } from "./Sheet";

const MAX_BYTES = 10 * 1024 * 1024;
const isImage = (type: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(type);

interface Uploading {
  key: string;
  name: string;
  preview: string | null;
}

export function Attachments({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef(taskId);
  live.current = taskId;

  useEffect(() => {
    let alive = true;
    setItems(null);
    api
      .attachments(taskId)
      .then((r) => alive && setItems(r.attachments))
      // a task created offline is not on the server yet: it has no files
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  async function add(files: FileList) {
    const forTask = taskId;
    for (const file of Array.from(files)) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setUploading((u) => [...u, { key, name: file.name, preview }]);
      try {
        const { blob, name } = await compressImage(file);
        if (blob.size > MAX_BYTES) {
          toast("10MB までのファイルにしてください");
          continue;
        }
        await flush(); // the task must exist on the server first
        const { attachment } = await api.upload(forTask, blob, name);
        if (live.current === forTask) {
          setItems((list) => {
            const next = [...(list ?? []), attachment];
            setAttachmentCount(forTask, next.length);
            return next;
          });
        }
        haptic();
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 0;
        toast(
          status === 507
            ? "保存容量（100MB）がいっぱいです"
            : status === 413
              ? "10MB までのファイルにしてください"
              : "アップロードできませんでした",
        );
      } finally {
        if (preview) URL.revokeObjectURL(preview);
        setUploading((u) => u.filter((x) => x.key !== key));
      }
    }
  }

  async function remove(att: Attachment) {
    if (armed !== att.id) {
      setArmed(att.id);
      haptic();
      return;
    }
    setArmed(null);
    const before = items ?? [];
    const next = before.filter((x) => x.id !== att.id);
    setItems(next);
    setAttachmentCount(taskId, next.length);
    try {
      await api.deleteAttachment(att.id);
    } catch {
      setItems(before);
      setAttachmentCount(taskId, before.length);
      toast("削除できませんでした");
    }
  }

  const open = (att: Attachment) => {
    if (isImage(att.type)) setViewing(att);
    else window.open(fileUrl(att.id), "_blank", "noopener");
  };

  return (
    <section className="atts">
      <div className="subs-head">
        <h3>添付</h3>
        <motion.button
          whileTap={{ scale: 0.94 }}
          className="btn small"
          onClick={() => input.current?.click()}
          data-testid="attach"
        >
          <Paperclip width={16} height={16} />
          追加
        </motion.button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="attach-input"
          onChange={(e) => {
            if (e.target.files?.length) void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items === null ? (
        <SkeletonRows n={1} />
      ) : (
        <motion.ul className="att-grid" layout>
          <AnimatePresence initial={false}>
            {items.map((att) => (
              <motion.li
                key={att.id}
                layout
                className={`att ${isImage(att.type) ? "img" : "doc"}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                data-testid="attachment"
              >
                <button className="att-open" onClick={() => open(att)} aria-label={`${att.name} を開く`}>
                  {isImage(att.type) ? (
                    <motion.img layoutId={`att-${att.id}`} src={fileUrl(att.id)} alt={att.name} loading="lazy" />
                  ) : (
                    <span className="att-doc">
                      <FileIcon width={22} height={22} />
                      <span className="att-name">{att.name}</span>
                      <span className="att-size">{formatSize(att.size)}</span>
                    </span>
                  )}
                </button>
                <motion.button
                  className={`att-del ${armed === att.id ? "armed" : ""}`}
                  aria-label={armed === att.id ? `${att.name} を削除` : `${att.name} の削除を確認`}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => void remove(att)}
                  data-testid="attachment-delete"
                  layout
                >
                  {armed === att.id ? "削除" : <Close width={12} height={12} />}
                </motion.button>
              </motion.li>
            ))}
            {uploading.map((u) => (
              <motion.li
                key={u.key}
                className="att img uploading"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                data-testid="attachment-uploading"
              >
                {u.preview ? <img src={u.preview} alt="" /> : <span className="att-doc">{u.name}</span>}
                <span className="att-progress" />
              </motion.li>
            ))}
          </AnimatePresence>
          {items.length === 0 && uploading.length === 0 && (
            <li className="att-add" key="add">
              <button onClick={() => input.current?.click()} aria-label="ファイルを添付">
                <Plus width={20} height={20} />
              </button>
            </li>
          )}
        </motion.ul>
      )}

      {createPortal(
        <AnimatePresence>
          {viewing && (
            <motion.div
              className="lightbox"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewing(null)}
              data-testid="lightbox"
            >
              <motion.img
                layoutId={`att-${viewing.id}`}
                src={fileUrl(viewing.id)}
                alt={viewing.name}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.7}
                onDragEnd={(_, info) => Math.abs(info.offset.y) > 120 && setViewing(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}
