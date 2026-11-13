/**
 * Thin wrappers around Base UI (https://base-ui.com) so the rest of the UI
 * uses one consistent set of controls. Base UI is unstyled; the look lives in
 * styles.css under the class names given here.
 */
import type React from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { Checkbox } from '@base-ui/react/checkbox';
import { Input } from '@base-ui/react/input';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Toast } from '@base-ui/react/toast';
import { Tooltip } from '@base-ui/react/tooltip';

type ButtonProps = React.ComponentProps<typeof BaseButton> & { variant?: 'primary' | 'danger'; size?: 'small' };

/** Push button. `variant` and `size` map to the .primary / .danger / .small styles. */
export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', variant, size, typeof className === 'string' ? className : ''].filter(Boolean).join(' ');
  return <BaseButton type={type} className={cls} {...rest} />;
}

/** Single-line text input. */
export const TextInput = Input;

/** Checkbox with a tick indicator. */
export function Check({ checked, onChange, id, 'aria-label': ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; id?: string; 'aria-label'?: string }) {
  return (
    <Checkbox.Root id={id} className="check" checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-label={ariaLabel}>
      <Checkbox.Indicator className="check-tick">
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
          <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

/** Drop-down list of string options. */
export function Select({ id, value, options, onChange }: { id?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <BaseSelect.Root items={options} value={value} onValueChange={(v) => v != null && onChange(String(v))}>
      <BaseSelect.Trigger id={id} className="select-trigger">
        <BaseSelect.Value className="select-value" />
        <BaseSelect.Icon className="select-icon">▾</BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="select-positioner" sideOffset={4}>
          <BaseSelect.Popup className="popup select-popup">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item key={o.value} value={o.value} className="popup-item">
                  <BaseSelect.ItemIndicator className="select-tick">✓</BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/**
 * Tooltip around a single element. `children` becomes the trigger, so pass a
 * Button or a plain element; with no `text` the child renders unchanged.
 */
export function Tip({ text, children }: { text?: string; children: React.ReactElement }) {
  if (!text) return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="tip-positioner">
          <Tooltip.Popup className="tip">{text}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TooltipProvider = Tooltip.Provider;

/** App-wide toast host. Wrap the app in <ToastProvider> and render <Toasts /> once. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider timeout={3500} limit={1}>
      {children}
    </Toast.Provider>
  );
}

export function Toasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="toast-viewport">
        {toasts.map((t) => (
          <Toast.Root key={t.id} toast={t} className="toast">
            <Toast.Content className="toast-content">
              <Toast.Description />
              <Toast.Close className="toast-close" aria-label="Dismiss">
                ×
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export const useToastManager = Toast.useToastManager;
