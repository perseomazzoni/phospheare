// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The shared UI kit: a directory, not a package, since it has one consumer.

export { default as Button, type ButtonVariant } from "./Button";
export { default as AccessCard, type AccessCardProps } from "./AccessCard";
export {
  default as Checklist,
  type ChecklistProps,
  type ChecklistStep,
} from "./Checklist";
export {
  CommandBar,
  CommandBarAction,
  CommandBarFind,
  CommandBarSegment,
  CommandBarToggle,
  CommandBarTrack,
  Tip,
} from "./CommandBar";
export { default as Avatar, type AvatarProps } from "./Avatar";
export { firstName } from "./firstName";
export { default as Dots } from "./Dots";
export {
  default as Meter,
  meterStage,
  type MeterProps,
  type MeterStage,
} from "./Meter";
export { default as Slider, type SliderProps } from "./Slider";
export { default as Disclosure } from "./Disclosure";
export { default as DriveNotice } from "./DriveNotice";
export { default as DeviceNotice } from "./DeviceNotice";
export { default as UpdateNotice } from "./UpdateNotice";
export { default as DemoNotice, DEMO_NOTICE_REGION_ID } from "./DemoNotice";
export { default as StatusNotice, NOTICE_STACK_ID } from "./StatusNotice";
export { useOnline } from "./useOnline";
export { default as EditorSkeleton } from "./EditorSkeleton";
export { default as SpineGlyph, type SpineGlyphProps } from "./SpineGlyph";
export { spineFill } from "./spineLayout";
export { Icon, ICON_NAMES, type IconName, type IconProps } from "./icons";
export {
  ListAddButton,
  ListRow,
  RowVerb,
  ShelfAddButton,
  ShelfHead,
  ShelfRow,
  ShelfVerb,
} from "./ListFace";
export { SettingPair, SettingPairs, SettingSection } from "./SettingRows";
export {
  default as Input,
  AreaInput,
  WrapInput,
  type AreaInputProps,
  type InputProps,
  type WrapInputProps,
} from "./Input";
export { default as Pick, type PickProps } from "./Pick";
export { default as StepRail, type StepRailProps } from "./StepRail";
export { default as JobProgress, type JobProgressProps } from "./JobProgress";
export {
  default as Tick,
  TickBox,
  type TickChecked,
  type TickProps,
} from "./Tick";
export {
  default as SegmentedControl,
  type Segment,
  type SegmentedControlProps,
} from "./SegmentedControl";
export {
  default as Select,
  type SelectOption,
  type SelectProps,
} from "./Select";
export { Kbd, Reason, Skeleton, Banner, type BannerTone } from "./Bits";
export {
  Scrim,
  AlertDialog,
  Dialog,
  DialogText,
  Sheet,
  OverlayBackgroundProvider,
  ProgressDialog,
  Menu,
  Popover,
  useMenuAnchor,
  ToastHost,
  useToasts,
  useOverlay,
  onScreen,
  onScreenPx,
  type ScrimProps,
  type AlertDialogProps,
  type DialogProps,
  type DialogTextProps,
  type SheetProps,
  type ProgressDialogProps,
  type MenuItem,
  type MenuProps,
  type PopoverProps,
  type ToastMessage,
  type Toasts,
} from "./overlay";
export { motionIsStill } from "./motion";
