"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/Spinner";
import { isUploadAbort, stageUpload, uploadErrorMessage } from "@/lib/direct-upload";
import { beginUpload, endUpload, useHoldSubmit } from "@/lib/upload-pending";
import type { UploadKind } from "@/lib/upload-limits";

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number | null }
  | { status: "staged"; path: string }
  | { status: "failed"; error: string };

const noSubscription = () => () => {};

/**
 * True once this component is running in the browser, false on the server and
 * through hydration — so the first client render matches the server's markup,
 * and only then does the field switch to the direct path.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

/**
 * A file field's direct upload (lib/direct-upload): choose a file and its
 * bytes go straight to Storage, leaving only the staged path for the form to
 * post — past Vercel's 4.5MB request cap, which the file itself would hit.
 *
 * Progressive enhancement is the server's markup: until this hydrates, the
 * plain <input type=file name=…> posts the file itself, as it always has
 * (fine for anything under the cap). Once it hydrates the file input loses
 * its name and a hidden input of the same name carries the path instead, so
 * the bytes are never sent twice. The action takes either (submittedFile).
 *
 * While a file is on its way, the form refuses to submit (useHoldSubmit) and
 * SubmitButton waits (upload-pending), as with an editor image. Once the form
 * is submitted with the path, the field clears: the save has the file now,
 * and the action removes the staged copy whatever it decides — so a second
 * save from the same page must not post that path again.
 */
export function useStagedUpload({ inputRef, name, kind, prepare, onFailed }: {
  /** The file input — the caller's, so it can sit wherever the field's markup wants it. */
  inputRef: RefObject<HTMLInputElement | null>;
  name: string;
  kind: UploadKind;
  /** Runs on the chosen file before it is sent — CoverField's in-browser resize. Must not throw. */
  prepare?: (file: File) => Promise<File>;
  /** The chosen file was refused or didn't arrive, and the input has been emptied — drop any preview of it. */
  onFailed?: () => void;
}) {
  const enhanced = useHydrated();
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  // The latest callbacks, read when an upload runs — so a caller needn't
  // memoise them, and `start` stays stable for the effect below.
  const callbacks = useRef({ prepare, onFailed });
  useEffect(() => {
    callbacks.current = { prepare, onFailed };
  }, [prepare, onFailed]);

  const start = useCallback(async (file: File | null) => {
    abortRef.current?.abort();
    if (!file) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "uploading", progress: null });
    // only this field's form waits for it (the same form must end it)
    const form = inputRef.current?.closest("form") ?? null;
    beginUpload(form);
    try {
      const { prepare } = callbacks.current;
      const ready = prepare ? await prepare(file) : file;
      if (controller.signal.aborted) return;
      const path = await stageUpload(ready, kind, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setState({ status: "uploading", progress });
        },
      });
      if (!controller.signal.aborted) setState({ status: "staged", path });
    } catch (e) {
      if (isUploadAbort(e) || controller.signal.aborted) return;
      setState({ status: "failed", error: uploadErrorMessage(e, kind) });
      // Emptied so choosing the same file again is a change (a retry), and so
      // a required field asks for one rather than letting the form go without.
      if (inputRef.current) inputRef.current.value = "";
      callbacks.current.onFailed?.();
    } finally {
      endUpload(form);
    }
  }, [inputRef, kind]);

  // Abandoned mid-upload (navigated away): stop sending.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A file chosen before this hydrated is still sitting in the input, with no
  // name left to post it under — send it now. Runs when `enhanced` turns true
  // (start is stable), and again only if StrictMode's rehearsal unmount
  // aborted the first attempt — which is then exactly what's wanted.
  useEffect(() => {
    const file = enhanced ? inputRef.current?.files?.[0] : undefined;
    if (file) void start(file);
  }, [enhanced, inputRef, start]);

  const uploading = state.status === "uploading";
  const noun = kind === "image" ? "image" : "file";
  const [holdNotice, setHoldNotice] = useState(false);
  const onHold = useCallback(() => setHoldNotice(true), []);
  useHoldSubmit(inputRef, uploading, onHold);

  // Submitted with this path: the save owns the file now — see above. Noted
  // during render (React's "adjust state when a prop changes" pattern), since
  // the form's status is only visible while the action is pending; the DOM
  // input is emptied in the effect after.
  const { pending, data } = useFormStatus();
  const [submittedPath, setSubmittedPath] = useState<string | null>(null);
  const staged = state.status === "staged" ? state.path : null;
  if (pending && staged && staged !== submittedPath && data?.getAll(name).includes(staged)) setSubmittedPath(staged);
  const stagedPath = staged && staged !== submittedPath ? staged : null;
  useEffect(() => {
    if (submittedPath && inputRef.current) inputRef.current.value = "";
  }, [submittedPath, inputRef]);

  return {
    enhanced,
    state,
    noun,
    holdNotice: uploading && holdNotice,
    /** For the file input's onChange. */
    choose: (file: File | null) => {
      setHoldNotice(false);
      void start(file);
    },
    stagedPath,
  };
}

/** The upload's live status and any refusal, plus the hidden field carrying the staged path. */
export function UploadStatus({ name, upload }: { name: string; upload: ReturnType<typeof useStagedUpload> }) {
  const { enhanced, state, noun, holdNotice, stagedPath } = upload;
  const error = state.status === "failed" ? state.error : holdNotice ? `Wait for the ${noun} to finish uploading, then save.` : null;
  return (
    <>
      {/* Always mounted, so the status is announced when it fills. */}
      <p role="status" className="mt-1 flex items-center gap-2 text-sm text-graphite empty:mt-0">
        {state.status === "uploading" && (
          <>
            <Spinner />
            Uploading {noun}…
            {/* Not announced: a screen reader re-reading every percent is noise. */}
            {state.progress !== null && <span aria-hidden="true">{Math.round(state.progress * 100)}%</span>}
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-1 rounded bg-danger/10 p-2 text-sm text-danger">
          {error}
        </p>
      )}
      {enhanced && <input type="hidden" name={name} value={stagedPath ?? ""} />}
    </>
  );
}

/**
 * The browser's own "Choose File" button, styled as a real button: bare it was
 * a ~20px-tall unstyled target (#33 M8). 44px tall on touch screens.
 */
export const FILE_BUTTON =
  "file:mr-3 file:cursor-pointer file:rounded file:border file:border-solid file:border-line file:bg-shade file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-line [@media(pointer:coarse)]:file:min-h-11";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "name" | "children"> & {
  name: string;
  /** What the field takes — the same rules the action applies (lib/upload-limits). Default "image". */
  kind?: UploadKind;
};

/**
 * Drop-in for `<input type="file" name=…>`: the same attributes and the same
 * look (it renders that input), uploading directly once JavaScript is up. The
 * action reads it with submittedFile(formData, name, owner).
 */
export function UploadField({ name, kind = "image", onChange, className, ...input }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useStagedUpload({ inputRef, name, kind });
  return (
    <>
      <input
        {...input}
        className={`${FILE_BUTTON} ${className ?? ""}`}
        ref={inputRef}
        type="file"
        name={upload.enhanced ? undefined : name}
        onChange={(e) => {
          onChange?.(e);
          upload.choose(e.target.files?.[0] ?? null);
        }}
      />
      <UploadStatus name={name} upload={upload} />
    </>
  );
}
