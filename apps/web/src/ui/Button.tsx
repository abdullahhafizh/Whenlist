import type { ButtonHTMLAttributes, ReactNode } from "react";
import { btn } from "./styles";

type Variant = keyof typeof btn;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export default function Button({
  variant = "primary",
  className = "",
  type = "button",
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`${btn[variant]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
