import { IconButton, type IconButtonProps } from "./Controls";
import { useControlTooltip } from "./useControlTooltip";

export function TooltipIconButton({ title, ...props }: IconButtonProps) {
  const { triggerProps, tooltip } = useControlTooltip(
    title ?? props["aria-label"],
  );
  return (
    <>
      <IconButton
        {...props}
        {...triggerProps}
        onClick={(event) => {
          triggerProps.onClick();
          props.onClick?.(event);
        }}
        onFocus={(event) => {
          props.onFocus?.(event);
          triggerProps.onFocus(event);
        }}
        onBlur={(event) => {
          props.onBlur?.(event);
          triggerProps.onBlur();
        }}
        onMouseEnter={(event) => {
          props.onMouseEnter?.(event);
          triggerProps.onMouseEnter(event);
        }}
        onMouseLeave={(event) => {
          props.onMouseLeave?.(event);
          triggerProps.onMouseLeave();
        }}
        onPointerDown={(event) => {
          props.onPointerDown?.(event);
          triggerProps.onPointerDown();
        }}
      />
      {tooltip}
    </>
  );
}
