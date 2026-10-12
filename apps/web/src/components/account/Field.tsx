import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import styles from "./Field.module.css";

type Common = {
  id: string;
  label: string;
  error?: string | null;
  helper?: string | null;
};

export type TextFieldProps = Common &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
    as?: "input";
  };

export type SelectFieldProps = Common &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    as: "select";
    options: Array<{ value: string; label: string }>;
  };

export type FieldProps = TextFieldProps | SelectFieldProps;

export function Field(props: FieldProps) {
  const { id, label, error, helper } = props;
  const describedBy = [
    error ? `${id}-error` : null,
    helper ? `${id}-helper` : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  const wrapClass = [
    styles["gb-field"],
    error ? styles["gb-field--error"] : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass}>
      <label className={styles["gb-field__label"]} htmlFor={id}>
        {label}
      </label>
      {props.as === "select" ? (
        <select
          id={id}
          className={styles["gb-field__control"]}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          value={props.value}
          defaultValue={props.defaultValue}
          onChange={props.onChange}
          disabled={props.disabled}
          name={props.name}
        >
          {props.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={styles["gb-field__control"]}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          type={props.type ?? "text"}
          value={props.value}
          defaultValue={props.defaultValue}
          onChange={props.onChange}
          disabled={props.disabled}
          name={props.name}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className={styles["gb-field__error"]} role="alert">
          {error}
        </p>
      ) : null}
      {!error && helper ? (
        <p id={`${id}-helper`} className={styles["gb-field__helper"]}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
