# @wren/ui

Role: package. Files: 195.

## Uses

- @wren/core

## Outside packages

node:child_process, node:fs, node:http, node:os, node:path, node:url, node:util

## Folders

Dotted: types only.

```mermaid
flowchart LR
  n_engine_[".engine/ (2)"]
  n_storybook_[".storybook/ (15)"]
  nmatch_["match/"]
  naccess_ts["access.ts"]
  naccounts_tsx["accounts.tsx"]
  naction_tsx["action.tsx"]
  nbrowser_tsx["browser.tsx"]
  nbusy_tsx["busy.tsx"]
  ncharts_["charts/ (3)"]
  ncomponents_["components/ (12)"]
  ncontrast_ts["contrast.ts"]
  ncontrols_tsx["controls.tsx"]
  ncopy_tsx["copy.tsx"]
  ncustomize_tsx["customize.tsx"]
  ndata_tsx["data.tsx"]
  ndata_["data/ (7)"]
  nday_tsx["day.tsx"]
  ndictate_text_ts["dictate-text.ts"]
  ndictate_tsx["dictate.tsx"]
  ndiff_tsx["diff.tsx"]
  ndisplay_ts["display.ts"]
  ndraft_save_ts["draft-save.ts"]
  ndraft_tsx["draft.tsx"]
  nedit_form_tsx["edit-form.tsx"]
  nedits_tsx["edits.tsx"]
  nfeedback_tsx["feedback.tsx"]
  nfields_tsx["fields.tsx"]
  nfixtures_["fixtures/ (18)"]
  nflow_map_graph_tsx["flow-map-graph.tsx"]
  nflow_map_tsx["flow-map.tsx"]
  nflow_ts["flow.ts"]
  nfold_tsx["fold.tsx"]
  nform_tsx["form.tsx"]
  nformat_ts["format.ts"]
  nframe_tsx["frame.tsx"]
  ngraph_["graph/ (9)"]
  nhandler_tsx["handler.tsx"]
  nhint_layer_tsx["hint-layer.tsx"]
  nhint_ts["hint.ts"]
  nhover_pop_ts["hover-pop.ts"]
  nicons_tsx["icons.tsx"]
  nindex_ts["index.ts"]
  nitem_link_tsx["item-link.tsx"]
  nlauncher_tsx["launcher.tsx"]
  nlayout_tsx["layout.tsx"]
  nlineage_graph_tsx["lineage-graph.tsx"]
  nlineage_tsx["lineage.tsx"]
  nlist_bar_tsx["list-bar.tsx"]
  nlist_search_ts["list-search.ts"]
  nlook_tsx["look.tsx"]
  nmarks_tsx["marks.tsx"]
  nmetro_["metro/ (22)"]
  nmotion_tsx["motion.tsx"]
  noverview_queues_tsx["overview-queues.tsx"]
  noverview_tsx["overview.tsx"]
  npage_bar_tsx["page-bar.tsx"]
  npager_ts["pager.ts"]
  npalette_brand_ts["palette-brand.ts"]
  npalette_scope_ts["palette-scope.ts"]
  npalette_tsx["palette.tsx"]
  npeek_tsx["peek.tsx"]
  nphone_nav_ts["phone-nav.ts"]
  nphone_shell_tsx["phone-shell.tsx"]
  nphone_tsx["phone.tsx"]
  npreview_tsx["preview.tsx"]
  nqueue_tsx["queue.tsx"]
  nrail_tsx["rail.tsx"]
  nread_aloud_tsx["read-aloud.tsx"]
  nrecord_access_tsx["record-access.tsx"]
  nrecord_head_ts["record-head.ts"]
  nrecord_patch_ts["record-patch.ts"]
  nrecords_columns_tsx["records-columns.tsx"]
  nrecords_list_tsx["records-list.tsx"]
  nrecords_local_ts["records-local.ts"]
  nrecords_page_tsx["records-page.tsx"]
  nrecords_panel_tsx["records-panel.tsx"]
  nrecords_swipes_ts["records-swipes.ts"]
  nrecords_types_ts["records-types.ts"]
  nrecords_tsx["records.tsx"]
  nrow_acts_tsx["row-acts.tsx"]
  nrows_tsx["rows.tsx"]
  nrun_graph_tsx["run-graph.tsx"]
  nrun_tsx["run.tsx"]
  nsafe_triangle_ts["safe-triangle.ts"]
  nsave_["save/ (12)"]
  nsettings_ts["settings.ts"]
  nshell_tsx["shell.tsx"]
  nshop_tsx["shop.tsx"]
  nsnippets_tsx["snippets.tsx"]
  nsources_tsx["sources.tsx"]
  nsplit_tsx["split.tsx"]
  nsteps_tsx["steps.tsx"]
  nsweep_tsx["sweep.tsx"]
  nswitch_bar_tsx["switch-bar.tsx"]
  ntab_bar_tsx["tab-bar.tsx"]
  ntable_tsx["table.tsx"]
  ntailwind_css["tailwind.css"]
  ntheme_tsx["theme.tsx"]
  ntimeline_axis_ts["timeline-axis.ts"]
  ntimeline_tsx["timeline.tsx"]
  ntoast_ts["toast.ts"]
  nvendor_marks_tsx["vendor-marks.tsx"]
  nview_says_ts["view-says.ts"]
  nwork_tsx["work.tsx"]
  n_engine_ --> nbusy_tsx
  n_engine_ --> ncomponents_
  n_engine_ --> ncontrols_tsx
  n_engine_ --> ndisplay_ts
  n_engine_ --> nfold_tsx
  n_engine_ --> nformat_ts
  n_engine_ --> nlayout_tsx
  n_engine_ --> nmarks_tsx
  n_engine_ --> nmetro_
  n_engine_ --> nsteps_tsx
  n_engine_ --> nsweep_tsx
  n_engine_ --> nswitch_bar_tsx
  n_engine_ --> ntab_bar_tsx
  n_engine_ --> ntailwind_css
  n_engine_ --> ntheme_tsx
  n_engine_ --> ntimeline_tsx
  n_storybook_ --> ndata_
  n_storybook_ --> nhint_layer_tsx
  n_storybook_ --> ntheme_tsx
  n_storybook_ --> nmatch_
  n_storybook_ --> ntailwind_css
  naccounts_tsx --> ncomponents_
  naccounts_tsx --> nhint_ts
  naccounts_tsx --> nhover_pop_ts
  naccounts_tsx --> nicons_tsx
  naccounts_tsx --> nmarks_tsx
  naccounts_tsx -.-> nrecords_tsx
  naction_tsx -.-> naccess_ts
  naction_tsx --> ncomponents_
  naction_tsx --> ncontrols_tsx
  naction_tsx --> ndata_
  naction_tsx --> ndictate_tsx
  naction_tsx --> nedit_form_tsx
  naction_tsx -.-> nicons_tsx
  naction_tsx --> npreview_tsx
  naction_tsx --> nsave_
  naction_tsx --> nsnippets_tsx
  naction_tsx --> ntoast_ts
  nbrowser_tsx --> nformat_ts
  nbrowser_tsx --> nicons_tsx
  ncharts_ --> ncomponents_
  ncharts_ --> nformat_ts
  ncomponents_ --> nbusy_tsx
  ncomponents_ --> nicons_tsx
  ncomponents_ --> nsweep_tsx
  ncontrast_ts --> ntheme_tsx
  ncontrols_tsx --> nbusy_tsx
  ncontrols_tsx --> ncomponents_
  ncontrols_tsx --> nhint_ts
  ncontrols_tsx --> nicons_tsx
  ncontrols_tsx --> nmotion_tsx
  ncopy_tsx --> ncontrols_tsx
  ncopy_tsx --> ntoast_ts
  ncustomize_tsx --> ncomponents_
  ncustomize_tsx --> nformat_ts
  ncustomize_tsx --> nhint_ts
  ncustomize_tsx --> nicons_tsx
  ncustomize_tsx --> nlayout_tsx
  ncustomize_tsx -.-> nlist_bar_tsx
  ncustomize_tsx --> nsave_
  ndata_tsx --> nformat_ts
  ndata_tsx --> nsettings_ts
  ndata_ --> nsave_
  ndata_ --> ncontrols_tsx
  nday_tsx --> naction_tsx
  nday_tsx --> ncontrols_tsx
  nday_tsx --> nfeedback_tsx
  nday_tsx --> nfields_tsx
  nday_tsx --> nformat_ts
  nday_tsx --> nicons_tsx
  nday_tsx --> nlayout_tsx
  nday_tsx --> nrecords_tsx
  nday_tsx --> nswitch_bar_tsx
  ndictate_tsx --> ndictate_text_ts
  ndictate_tsx --> nhint_ts
  ndiff_tsx --> nformat_ts
  ndraft_save_ts -.-> naction_tsx
  ndraft_save_ts -.-> ndraft_tsx
  ndraft_save_ts --> nsave_
  ndraft_tsx --> naccounts_tsx
  ndraft_tsx --> naction_tsx
  ndraft_tsx --> ncomponents_
  ndraft_tsx --> ncontrols_tsx
  ndraft_tsx --> ndata_
  ndraft_tsx --> ndictate_tsx
  ndraft_tsx --> ndraft_save_ts
  ndraft_tsx --> npreview_tsx
  ndraft_tsx --> nsave_
  ndraft_tsx --> nsnippets_tsx
  ndraft_tsx --> ntoast_ts
  nedit_form_tsx --> naccounts_tsx
  nedit_form_tsx --> ncomponents_
  nedit_form_tsx --> ndata_
  nedit_form_tsx --> nsave_
  nedits_tsx --> naction_tsx
  nedits_tsx --> ncomponents_
  nedits_tsx --> ncontrols_tsx
  nedits_tsx --> ndata_
  nedits_tsx --> ndictate_tsx
  nedits_tsx --> nicons_tsx
  nedits_tsx --> nlayout_tsx
  nedits_tsx --> nsave_
  nedits_tsx --> nsnippets_tsx
  nedits_tsx --> ntoast_ts
  nfeedback_tsx --> ncomponents_
  nfeedback_tsx --> ncontrols_tsx
  nfeedback_tsx --> nformat_ts
  nfields_tsx --> naccounts_tsx
  nfields_tsx --> nformat_ts
  nfields_tsx --> nhint_ts
  nfields_tsx --> nicons_tsx
  nfields_tsx --> nmarks_tsx
  nfields_tsx --> nsources_tsx
  nfixtures_ -.-> naction_tsx
  nfixtures_ -.-> ncharts_
  nfixtures_ -.-> nday_tsx
  nfixtures_ -.-> nrecords_tsx
  nfixtures_ --> ndata_
  nfixtures_ -.-> ndraft_tsx
  nfixtures_ --> nsave_
  nfixtures_ -.-> ngraph_
  nfixtures_ -.-> nlist_bar_tsx
  nfixtures_ -.-> noverview_queues_tsx
  nfixtures_ -.-> noverview_tsx
  nfixtures_ --> nrecords_local_ts
  nfixtures_ -.-> ncustomize_tsx
  nfixtures_ -.-> nshell_tsx
  nfixtures_ --> ncomponents_
  nfixtures_ --> ncontrols_tsx
  nfixtures_ -.-> ntable_tsx
  nflow_map_graph_tsx -.-> nflow_map_tsx
  nflow_map_graph_tsx --> ngraph_
  nflow_map_tsx --> nflow_map_graph_tsx
  nfold_tsx --> nfields_tsx
  nfold_tsx --> nsources_tsx
  nform_tsx --> naction_tsx
  nform_tsx --> ncontrols_tsx
  nform_tsx --> nfeedback_tsx
  nform_tsx --> nfields_tsx
  nform_tsx --> nlayout_tsx
  nform_tsx --> nrecords_tsx
  nframe_tsx --> ncomponents_
  nframe_tsx --> ncontrols_tsx
  nframe_tsx --> ncustomize_tsx
  nframe_tsx --> ndisplay_ts
  nframe_tsx --> nformat_ts
  nframe_tsx --> nhint_ts
  nframe_tsx --> nicons_tsx
  nframe_tsx --> nlayout_tsx
  nframe_tsx -.-> nlist_bar_tsx
  ngraph_ --> ncomponents_
  ngraph_ --> nhint_ts
  ngraph_ --> nicons_tsx
  ngraph_ --> ncontrols_tsx
  ngraph_ --> nformat_ts
  nhandler_tsx --> naction_tsx
  nhandler_tsx --> ncomponents_
  nhandler_tsx --> ncontrols_tsx
  nhandler_tsx --> ndata_tsx
  nhandler_tsx --> nedit_form_tsx
  nhandler_tsx --> nfeedback_tsx
  nhandler_tsx --> nlayout_tsx
  nhandler_tsx --> ntoast_ts
  nhint_layer_tsx --> nhint_ts
  nicons_tsx --> nformat_ts
  nindex_ts --> naccess_ts
  nindex_ts --> naccounts_tsx
  nindex_ts --> naction_tsx
  nindex_ts --> nbrowser_tsx
  nindex_ts --> nbusy_tsx
  nindex_ts --> ncharts_
  nindex_ts --> ncomponents_
  nindex_ts --> ncontrols_tsx
  nindex_ts --> ncopy_tsx
  nindex_ts --> ncustomize_tsx
  nindex_ts --> ndata_tsx
  nindex_ts --> ndata_
  nindex_ts --> nday_tsx
  nindex_ts --> ndictate_text_ts
  nindex_ts --> ndictate_tsx
  nindex_ts --> ndiff_tsx
  nindex_ts --> ndisplay_ts
  nindex_ts --> ndraft_save_ts
  nindex_ts --> ndraft_tsx
  nindex_ts --> nedit_form_tsx
  nindex_ts --> nfeedback_tsx
  nindex_ts --> nfields_tsx
  nindex_ts --> nflow_map_tsx
  nindex_ts --> nflow_ts
  nindex_ts --> nfold_tsx
  nindex_ts --> nform_tsx
  nindex_ts --> nformat_ts
  nindex_ts --> nframe_tsx
  nindex_ts --> ngraph_
  nindex_ts --> nhandler_tsx
  nindex_ts --> nhint_layer_tsx
  nindex_ts --> nhint_ts
  nindex_ts --> nhover_pop_ts
  nindex_ts --> nicons_tsx
  nindex_ts --> nlauncher_tsx
  nindex_ts --> nlayout_tsx
  nindex_ts --> nlineage_tsx
  nindex_ts --> nlist_bar_tsx
  nindex_ts --> nlist_search_ts
  nindex_ts --> nlook_tsx
  nindex_ts --> nmarks_tsx
  nindex_ts --> nmotion_tsx
  nindex_ts --> noverview_tsx
  nindex_ts --> npalette_brand_ts
  nindex_ts --> npalette_scope_ts
  nindex_ts -.-> npalette_tsx
  nindex_ts -.-> npeek_tsx
  nindex_ts --> nphone_nav_ts
  nindex_ts --> nphone_shell_tsx
  nindex_ts --> nphone_tsx
  nindex_ts --> npreview_tsx
  nindex_ts --> nqueue_tsx
  nindex_ts --> nrail_tsx
  nindex_ts --> nread_aloud_tsx
  nindex_ts --> nrecord_access_tsx
  nindex_ts --> nrecord_patch_ts
  nindex_ts --> nrecords_local_ts
  nindex_ts --> nrecords_tsx
  nindex_ts --> nrow_acts_tsx
  nindex_ts --> nrows_tsx
  nindex_ts --> nrun_tsx
  nindex_ts --> nsave_
  nindex_ts --> nsettings_ts
  nindex_ts --> nshell_tsx
  nindex_ts --> nshop_tsx
  nindex_ts --> nsnippets_tsx
  nindex_ts --> nsources_tsx
  nindex_ts --> nsplit_tsx
  nindex_ts --> nsteps_tsx
  nindex_ts --> nsweep_tsx
  nindex_ts --> nswitch_bar_tsx
  nindex_ts --> ntab_bar_tsx
  nindex_ts --> ntable_tsx
  nindex_ts --> ntheme_tsx
  nindex_ts --> ntimeline_tsx
  nindex_ts --> nview_says_ts
  nindex_ts --> nwork_tsx
  nitem_link_tsx --> nhint_ts
  nitem_link_tsx --> nicons_tsx
  nlauncher_tsx --> ncomponents_
  nlauncher_tsx --> nformat_ts
  nlauncher_tsx --> nicons_tsx
  nlauncher_tsx --> nlayout_tsx
  nlayout_tsx --> nformat_ts
  nlineage_graph_tsx --> ngraph_
  nlineage_graph_tsx -.-> nlineage_tsx
  nlineage_tsx --> nlineage_graph_tsx
  nlist_bar_tsx --> naccounts_tsx
  nlist_bar_tsx --> ncomponents_
  nlist_bar_tsx --> ncontrols_tsx
  nlist_bar_tsx --> ndata_
  nlist_bar_tsx --> nedit_form_tsx
  nlist_bar_tsx --> nfields_tsx
  nlist_bar_tsx --> nformat_ts
  nlist_bar_tsx --> nhint_ts
  nlist_bar_tsx --> nhover_pop_ts
  nlist_bar_tsx --> nicons_tsx
  nlist_bar_tsx --> nlist_search_ts
  nlist_bar_tsx --> nmotion_tsx
  nlist_bar_tsx --> nphone_tsx
  nlist_bar_tsx -.-> nrecords_tsx
  nlist_bar_tsx --> ntab_bar_tsx
  nlist_bar_tsx --> nview_says_ts
  nlist_search_ts --> npager_ts
  nlook_tsx --> ncomponents_
  nlook_tsx --> ncontrols_tsx
  nlook_tsx --> ndata_
  nlook_tsx --> npalette_brand_ts
  nlook_tsx --> ntheme_tsx
  nlook_tsx --> ntoast_ts
  nmetro_ --> nformat_ts
  nmetro_ --> nicons_tsx
  nmetro_ --> ngraph_
  nmetro_ --> ncontrols_tsx
  nmotion_tsx --> nbusy_tsx
  noverview_queues_tsx --> ndata_
  noverview_queues_tsx --> nfeedback_tsx
  noverview_queues_tsx --> nformat_ts
  noverview_queues_tsx -.-> nicons_tsx
  noverview_queues_tsx -.-> nrecords_tsx
  noverview_queues_tsx --> nsplit_tsx
  noverview_tsx --> ncharts_
  noverview_tsx --> ncustomize_tsx
  noverview_tsx --> nfeedback_tsx
  noverview_tsx --> nfields_tsx
  noverview_tsx --> nformat_ts
  noverview_tsx --> nhint_ts
  noverview_tsx --> nlayout_tsx
  noverview_tsx --> nlist_bar_tsx
  noverview_tsx -.-> noverview_queues_tsx
  noverview_tsx --> nrecords_tsx
  npage_bar_tsx --> nformat_ts
  npage_bar_tsx --> nicons_tsx
  npage_bar_tsx --> npager_ts
  npage_bar_tsx -.-> nrecords_tsx
  npalette_brand_ts --> ncontrast_ts
  npalette_brand_ts -.-> ntheme_tsx
  npalette_scope_ts -.-> nicons_tsx
  npalette_tsx --> ncomponents_
  npalette_tsx --> ndictate_tsx
  npalette_tsx --> nicons_tsx
  npalette_tsx --> npalette_scope_ts
  npalette_tsx --> ntoast_ts
  npeek_tsx --> nfeedback_tsx
  npeek_tsx --> nfields_tsx
  npeek_tsx --> nrows_tsx
  nphone_nav_ts -.-> nicons_tsx
  nphone_shell_tsx --> ncustomize_tsx
  nphone_shell_tsx --> nformat_ts
  nphone_shell_tsx --> nicons_tsx
  nphone_shell_tsx --> nphone_nav_ts
  nphone_shell_tsx --> nphone_tsx
  nphone_shell_tsx -.-> nshell_tsx
  nphone_tsx --> nbusy_tsx
  nphone_tsx --> ndata_
  nphone_tsx --> nformat_ts
  nphone_tsx --> nhint_ts
  nphone_tsx --> nmotion_tsx
  nphone_tsx --> nphone_nav_ts
  npreview_tsx --> nread_aloud_tsx
  nqueue_tsx --> naction_tsx
  nqueue_tsx --> ncontrols_tsx
  nqueue_tsx --> ndata_
  nqueue_tsx --> nfeedback_tsx
  nqueue_tsx --> nfields_tsx
  nqueue_tsx --> nformat_ts
  nqueue_tsx --> nframe_tsx
  nqueue_tsx --> nhint_layer_tsx
  nqueue_tsx --> nhint_ts
  nqueue_tsx --> nicons_tsx
  nqueue_tsx --> nlayout_tsx
  nqueue_tsx --> nlist_bar_tsx
  nqueue_tsx --> nrecords_tsx
  nrail_tsx --> nicons_tsx
  nrail_tsx --> nlayout_tsx
  nread_aloud_tsx --> nhint_ts
  nrecord_access_tsx --> naccess_ts
  nrecord_access_tsx --> ncomponents_
  nrecord_access_tsx --> ncontrols_tsx
  nrecord_access_tsx --> ndata_
  nrecord_access_tsx --> nlayout_tsx
  nrecord_access_tsx --> ntoast_ts
  nrecord_patch_ts --> ndata_
  nrecords_columns_tsx --> ncomponents_
  nrecords_columns_tsx --> nfields_tsx
  nrecords_columns_tsx --> nformat_ts
  nrecords_columns_tsx --> nframe_tsx
  nrecords_columns_tsx --> nhint_ts
  nrecords_columns_tsx --> nhover_pop_ts
  nrecords_columns_tsx --> nicons_tsx
  nrecords_columns_tsx --> nlist_bar_tsx
  nrecords_columns_tsx --> npager_ts
  nrecords_columns_tsx --> nrecords_types_ts
  nrecords_list_tsx --> naction_tsx
  nrecords_list_tsx --> ncomponents_
  nrecords_list_tsx --> ncontrols_tsx
  nrecords_list_tsx --> ndata_
  nrecords_list_tsx --> nfeedback_tsx
  nrecords_list_tsx --> nfields_tsx
  nrecords_list_tsx --> nfold_tsx
  nrecords_list_tsx --> nformat_ts
  nrecords_list_tsx --> nframe_tsx
  nrecords_list_tsx --> nhint_ts
  nrecords_list_tsx --> nicons_tsx
  nrecords_list_tsx --> nlayout_tsx
  nrecords_list_tsx --> nlist_bar_tsx
  nrecords_list_tsx --> npage_bar_tsx
  nrecords_list_tsx --> npager_ts
  nrecords_list_tsx --> npalette_scope_ts
  nrecords_list_tsx --> nrecords_columns_tsx
  nrecords_list_tsx --> nrecords_panel_tsx
  nrecords_list_tsx --> nrecords_swipes_ts
  nrecords_list_tsx --> nrecords_types_ts
  nrecords_list_tsx --> nrow_acts_tsx
  nrecords_list_tsx --> nrows_tsx
  nrecords_list_tsx --> ntable_tsx
  nrecords_list_tsx --> nview_says_ts
  nrecords_local_ts --> naction_tsx
  nrecords_local_ts -.-> nrecords_tsx
  nrecords_page_tsx --> naccess_ts
  nrecords_page_tsx --> naction_tsx
  nrecords_page_tsx --> ncontrols_tsx
  nrecords_page_tsx --> ndata_
  nrecords_page_tsx --> ndraft_save_ts
  nrecords_page_tsx --> ndraft_tsx
  nrecords_page_tsx --> nedits_tsx
  nrecords_page_tsx --> nfeedback_tsx
  nrecords_page_tsx --> nfields_tsx
  nrecords_page_tsx --> nfold_tsx
  nrecords_page_tsx --> nformat_ts
  nrecords_page_tsx --> nhint_layer_tsx
  nrecords_page_tsx --> nitem_link_tsx
  nrecords_page_tsx --> nlayout_tsx
  nrecords_page_tsx --> nlist_bar_tsx
  nrecords_page_tsx --> npalette_scope_ts
  nrecords_page_tsx --> nrecord_access_tsx
  nrecords_page_tsx --> nrecord_head_ts
  nrecords_page_tsx --> nrecord_patch_ts
  nrecords_page_tsx --> nrecords_columns_tsx
  nrecords_page_tsx --> nrecords_types_ts
  nrecords_page_tsx --> nsave_
  nrecords_page_tsx --> nsources_tsx
  nrecords_page_tsx --> ntab_bar_tsx
  nrecords_page_tsx --> ntable_tsx
  nrecords_panel_tsx -.-> naction_tsx
  nrecords_panel_tsx --> ndata_
  nrecords_panel_tsx --> nfeedback_tsx
  nrecords_panel_tsx --> nfields_tsx
  nrecords_panel_tsx --> nformat_ts
  nrecords_panel_tsx --> nhint_ts
  nrecords_panel_tsx --> nicons_tsx
  nrecords_panel_tsx --> npeek_tsx
  nrecords_panel_tsx --> nphone_shell_tsx
  nrecords_panel_tsx --> nphone_tsx
  nrecords_panel_tsx --> nrecords_columns_tsx
  nrecords_panel_tsx --> nrecords_page_tsx
  nrecords_panel_tsx --> nrecords_types_ts
  nrecords_panel_tsx --> nrow_acts_tsx
  nrecords_panel_tsx --> nrows_tsx
  nrecords_panel_tsx --> nsweep_tsx
  nrecords_swipes_ts --> naction_tsx
  nrecords_swipes_ts --> nphone_tsx
  nrecords_types_ts --> naccess_ts
  nrecords_types_ts --> naction_tsx
  nrecords_types_ts --> ndata_
  nrecords_types_ts -.-> ndraft_tsx
  nrecords_types_ts --> nfields_tsx
  nrecords_types_ts -.-> nframe_tsx
  nrecords_types_ts -.-> nlist_bar_tsx
  nrecords_types_ts -.-> npeek_tsx
  nrecords_types_ts --> nrecord_access_tsx
  nrecords_types_ts --> nsave_
  nrecords_types_ts --> nsources_tsx
  nrecords_tsx -.-> ndata_
  nrecords_tsx --> nlist_bar_tsx
  nrecords_tsx --> nrecords_columns_tsx
  nrecords_tsx --> nrecords_list_tsx
  nrecords_tsx --> nrecords_page_tsx
  nrecords_tsx -.-> nrecords_panel_tsx
  nrecords_tsx --> nrecords_swipes_ts
  nrecords_tsx -.-> nrecords_types_ts
  nrow_acts_tsx --> naction_tsx
  nrow_acts_tsx --> ncomponents_
  nrow_acts_tsx --> ncontrols_tsx
  nrow_acts_tsx --> nedit_form_tsx
  nrow_acts_tsx --> nhint_ts
  nrow_acts_tsx --> nicons_tsx
  nrows_tsx --> ncontrols_tsx
  nrows_tsx --> nformat_ts
  nrows_tsx --> nicons_tsx
  nrows_tsx --> nmarks_tsx
  nrows_tsx --> nphone_tsx
  nrows_tsx --> nrow_acts_tsx
  nrows_tsx --> ntable_tsx
  nrun_graph_tsx --> nflow_ts
  nrun_graph_tsx --> nformat_ts
  nrun_graph_tsx --> ngraph_
  nrun_graph_tsx --> nicons_tsx
  nrun_graph_tsx --> nrun_tsx
  nrun_tsx --> nflow_ts
  nrun_tsx --> nformat_ts
  nrun_tsx --> nhint_ts
  nrun_tsx --> nicons_tsx
  nrun_tsx --> nrun_graph_tsx
  nrun_tsx --> nwork_tsx
  nsave_ --> ndata_
  nsave_ --> ncontrols_tsx
  nshell_tsx --> ncomponents_
  nshell_tsx --> ncustomize_tsx
  nshell_tsx --> ndata_
  nshell_tsx --> ndisplay_ts
  nshell_tsx --> nformat_ts
  nshell_tsx --> nframe_tsx
  nshell_tsx --> nhint_ts
  nshell_tsx --> nicons_tsx
  nshell_tsx --> nlayout_tsx
  nshell_tsx --> nphone_nav_ts
  nshell_tsx --> nphone_shell_tsx
  nshell_tsx --> nsafe_triangle_ts
  nshell_tsx --> ntheme_tsx
  nshop_tsx --> ncontrols_tsx
  nshop_tsx --> ndata_
  nshop_tsx --> nfeedback_tsx
  nshop_tsx --> nfields_tsx
  nshop_tsx --> nformat_ts
  nshop_tsx --> nicons_tsx
  nshop_tsx --> nlayout_tsx
  nshop_tsx --> nrecords_tsx
  nsnippets_tsx --> ncomponents_
  nsnippets_tsx --> ndata_
  nsnippets_tsx --> nhint_ts
  nsources_tsx --> nicons_tsx
  nsources_tsx --> nlayout_tsx
  nsplit_tsx --> ncharts_
  nsplit_tsx --> ncomponents_
  nsplit_tsx --> nfeedback_tsx
  nsplit_tsx --> nicons_tsx
  nsteps_tsx --> nbusy_tsx
  nsteps_tsx --> nformat_ts
  nsteps_tsx --> nlayout_tsx
  nsteps_tsx --> nmarks_tsx
  nswitch_bar_tsx --> nfeedback_tsx
  nswitch_bar_tsx --> nfields_tsx
  nswitch_bar_tsx --> nformat_ts
  nswitch_bar_tsx --> nhint_ts
  nswitch_bar_tsx --> nmarks_tsx
  nswitch_bar_tsx --> nrecords_tsx
  ntab_bar_tsx --> nmotion_tsx
  ntheme_tsx --> npalette_brand_ts
  ntimeline_tsx --> ncontrols_tsx
  ntimeline_tsx --> ndata_
  ntimeline_tsx --> nfeedback_tsx
  ntimeline_tsx --> nfields_tsx
  ntimeline_tsx --> nformat_ts
  ntimeline_tsx --> nhint_ts
  ntimeline_tsx --> nicons_tsx
  ntimeline_tsx --> nitem_link_tsx
  ntimeline_tsx --> nlayout_tsx
  ntimeline_tsx --> nlist_bar_tsx
  ntimeline_tsx --> nmarks_tsx
  ntimeline_tsx --> nrecords_tsx
  ntimeline_tsx --> ntimeline_axis_ts
  nvendor_marks_tsx --> nmarks_tsx
  nview_says_ts --> nfields_tsx
  nview_says_ts --> nformat_ts
  nwork_tsx --> nformat_ts
  nwork_tsx --> nicons_tsx
  nwork_tsx --> nlayout_tsx
  nwork_tsx --> nmarks_tsx
  nwork_tsx --> nsources_tsx
```

## Files

- .engine/: .engine/entry.ts, .engine/vite.config.ts
- .storybook/: .storybook/feedback.tsx, .storybook/frame.tsx, .storybook/look.mjs, .storybook/look.ts, .storybook/looks.ts, .storybook/main.ts, .storybook/match.mjs, .storybook/preview.tsx, .storybook/run.mjs, .storybook/serve.mjs, .storybook/shot.mjs, .storybook/static.mjs, .storybook/story-tests.ts, .storybook/vitest.config.ts, .storybook/vitest.setup.ts
- access.ts
- accounts.tsx
- action.tsx
- browser.tsx
- busy.tsx
- charts/: src/charts/draw.tsx, src/charts/heat.tsx, src/charts/index.tsx
- components/: src/components/ui/badge.tsx, src/components/ui/button.tsx, src/components/ui/chart.tsx, src/components/ui/command.tsx, src/components/ui/dialog.tsx, src/components/ui/input-group.tsx, src/components/ui/input.tsx, src/components/ui/popover.tsx, src/components/ui/sheet.tsx, src/components/ui/skeleton.tsx, src/components/ui/sonner.tsx, src/components/ui/textarea.tsx
- contrast.ts
- controls.tsx
- copy.tsx
- customize.tsx
- data.tsx
- data/: src/data/delta.ts, src/data/edits.ts, src/data/index.ts, src/data/local.ts, src/data/query.ts, src/data/status.tsx, src/data/use-edit.tsx
- day.tsx
- dictate-text.ts
- dictate.tsx
- diff.tsx
- display.ts
- draft-save.ts
- draft.tsx
- edit-form.tsx
- edits.tsx
- feedback.tsx
- fields.tsx
- fixtures/: src/fixtures/accounts.ts, src/fixtures/action.ts, src/fixtures/charts.ts, src/fixtures/dashboard.ts, src/fixtures/day.ts, src/fixtures/diff.ts, src/fixtures/draft.ts, src/fixtures/edit-form.ts, src/fixtures/graph.ts, src/fixtures/index.ts, src/fixtures/list-bar.ts, src/fixtures/load.ts, src/fixtures/overview.ts, src/fixtures/place.ts, src/fixtures/records.ts, src/fixtures/shell.ts, src/fixtures/table.tsx, src/fixtures/worst.ts
- flow-map-graph.tsx
- flow-map.tsx
- flow.ts
- fold.tsx
- form.tsx
- format.ts
- frame.tsx
- graph/: src/graph/canvas.tsx, src/graph/frame.tsx, src/graph/index.tsx, src/graph/journey.ts, src/graph/lanes.ts, src/graph/layout.ts, src/graph/look.ts, src/graph/model.ts, src/graph/palette.tsx
- handler.tsx
- hint-layer.tsx
- hint.ts
- hover-pop.ts
- icons.tsx
- index.ts
- item-link.tsx
- launcher.tsx
- layout.tsx
- lineage-graph.tsx
- lineage.tsx
- list-bar.tsx
- list-search.ts
- look.tsx
- marks.tsx
- match/: match/parts.ts
- metro/: src/metro/data.ts, src/metro/draw.tsx, src/metro/focus.ts, src/metro/fold.ts, src/metro/geometry.ts, src/metro/glide.ts, src/metro/index.ts, src/metro/lab/cases.ts, src/metro/lab/engines.ts, src/metro/lab/generate.ts, src/metro/lab/score.ts, src/metro/lab/to-view.ts, src/metro/layout.ts, src/metro/map.tsx, src/metro/marks.tsx, src/metro/metro.css, src/metro/money-models.ts, src/metro/place.ts, src/metro/samples.ts, src/metro/skeleton.tsx, src/metro/types.ts, src/metro/view.ts
- motion.tsx
- overview-queues.tsx
- overview.tsx
- page-bar.tsx
- pager.ts
- palette-brand.ts
- palette-scope.ts
- palette.tsx
- peek.tsx
- phone-nav.ts
- phone-shell.tsx
- phone.tsx
- preview.tsx
- queue.tsx
- rail.tsx
- read-aloud.tsx
- record-access.tsx
- record-head.ts
- record-patch.ts
- records-columns.tsx
- records-list.tsx
- records-local.ts
- records-page.tsx
- records-panel.tsx
- records-swipes.ts
- records-types.ts
- records.tsx
- row-acts.tsx
- rows.tsx
- run-graph.tsx
- run.tsx
- safe-triangle.ts
- save/: src/save/clock.ts, src/save/engine.ts, src/save/env.ts, src/save/index.ts, src/save/journal.ts, src/save/latest.ts, src/save/lock.ts, src/save/once.ts, src/save/page.ts, src/save/react.tsx, src/save/test-kit.ts, src/save/writes.ts
- settings.ts
- shell.tsx
- shop.tsx
- snippets.tsx
- sources.tsx
- split.tsx
- steps.tsx
- sweep.tsx
- switch-bar.tsx
- tab-bar.tsx
- table.tsx
- tailwind.css
- theme.tsx
- timeline-axis.ts
- timeline.tsx
- toast.ts
- vendor-marks.tsx
- view-says.ts
- work.tsx
