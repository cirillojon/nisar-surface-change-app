// The components every docs MDX page can use without importing them. Kept
// apart from the components themselves (mdx.jsx), so that file exports only
// components and keeps Fast Refresh.
import {
  AIOnly,
  ApiTry,
  Art,
  AskAI,
  Callout,
  Card,
  Cards,
  H2,
  H3,
  LandChangeTable,
  OpenInWorkspace,
  Pre,
  SiteTable,
  SmartLink,
  StoryTable,
  Table,
} from "./mdx.jsx";

export const mdxComponents = {
  h2: H2,
  h3: H3,
  a: SmartLink,
  pre: Pre,
  table: Table,
  Art,
  Callout,
  Cards,
  Card,
  OpenInWorkspace,
  AskAI,
  AIOnly,
  ApiTry,
  SiteTable,
  LandChangeTable,
  StoryTable,
};
