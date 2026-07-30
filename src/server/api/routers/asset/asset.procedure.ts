import { createTRPCRouter, workspaceProcedure } from "../../trpc";
import * as inputs from "./asset.input";
import * as services from "./asset.service";

export const assetRouter = createTRPCRouter({
  /** What this workspace may do with assets, so the UI doesn't have to guess. */
  capabilities: workspaceProcedure.query(({ ctx }) => {
    return services.getAssetCapabilities(ctx);
  }),
  list: workspaceProcedure.input(inputs.listAssetsInput).query(({ ctx, input }) => {
    return services.listAssets(ctx, input);
  }),
  recent: workspaceProcedure.input(inputs.recentAssetsInput).query(({ ctx, input }) => {
    return services.recentAssets(ctx, input);
  }),
  usage: workspaceProcedure.input(inputs.assetIdInput).query(({ ctx, input }) => {
    return services.getAssetUsage(ctx, input.id);
  }),
  upload: workspaceProcedure.input(inputs.uploadAssetInput).mutation(({ ctx, input }) => {
    return services.uploadAsset(ctx, input);
  }),
  update: workspaceProcedure.input(inputs.updateAssetInput).mutation(({ ctx, input }) => {
    return services.updateAsset(ctx, input);
  }),
  delete: workspaceProcedure.input(inputs.assetIdInput).mutation(({ ctx, input }) => {
    return services.deleteAsset(ctx, input.id);
  }),
  restore: workspaceProcedure.input(inputs.assetIdInput).mutation(({ ctx, input }) => {
    return services.restoreAsset(ctx, input.id);
  }),
  purge: workspaceProcedure.input(inputs.assetIdInput).mutation(({ ctx, input }) => {
    return services.purgeAsset(ctx, input.id);
  }),

  listFolders: workspaceProcedure.query(({ ctx }) => {
    return services.listFolders(ctx);
  }),
  createFolder: workspaceProcedure.input(inputs.createFolderInput).mutation(({ ctx, input }) => {
    return services.createFolder(ctx, input);
  }),
  updateFolder: workspaceProcedure.input(inputs.updateFolderInput).mutation(({ ctx, input }) => {
    return services.updateFolder(ctx, input);
  }),
  deleteFolder: workspaceProcedure.input(inputs.folderIdInput).mutation(({ ctx, input }) => {
    return services.deleteFolder(ctx, input.id);
  }),
});
