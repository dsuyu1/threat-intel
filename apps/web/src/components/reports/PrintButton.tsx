"use client";

export function PrintButton(props: { children: string; className?: string }) {
  return (
    <button
      className={props.className}
      onClick={() => {
        try {
          window.print();
        } catch {
          // ignore
        }
      }}
      type="button"
    >
      {props.children}
    </button>
  );
}

