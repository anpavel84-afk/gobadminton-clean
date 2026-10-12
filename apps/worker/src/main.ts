/**
 * Worker executable entrypoint (same backend release as apps/api).
 * Implementation lives in apps/api so domain cleanup commands are not copied.
 */
import "../../../api/src/worker-main";
