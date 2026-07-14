#define _DARWIN_C_SOURCE 1

#include <sys/acl.h>
#include <sys/attr.h>
#include <sys/file.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <sys/xattr.h>

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef O_SYMLINK
#error "cleanup-macos-helper requires macOS O_SYMLINK"
#endif

#ifndef RENAME_EXCL
#error "cleanup-macos-helper requires macOS RENAME_EXCL"
#endif

#define HELPER_PROTOCOL "skills-refiner.macos-helper.v1"
#ifndef SR_SOURCE_SHA256
#define SR_SOURCE_SHA256 "unbound-source"
#endif
#ifndef SR_COMPILER_PATH
#define SR_COMPILER_PATH "unknown-compiler"
#endif
#ifndef SR_COMPILER_VERSION
#define SR_COMPILER_VERSION "unknown-compiler-version"
#endif
#define MAX_INPUT_BYTES (1024U * 1024U)
#define MAX_MANIFEST_BYTES (512ULL * 1024ULL * 1024ULL)
#define MAX_METADATA_BYTES (64ULL * 1024ULL * 1024ULL)
#define MAX_MANIFEST_OBJECTS 100000ULL
#define MAX_MANIFEST_DEPTH 64U
#define SHA256_HEX_BYTES 65U
#define MAX_SAFE_JSON_INTEGER 9007199254740991ULL

typedef struct {
    uint64_t content_bytes;
    uint64_t metadata_bytes;
    uint64_t objects;
} manifest_budget;

typedef struct {
    uint32_t state[8];
    uint64_t bit_count;
    unsigned char buffer[64];
    size_t buffer_length;
} sha256_context;

static const uint32_t sha256_constants[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
    0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
    0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
    0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
    0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
    0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
    0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
    0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
    0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
    0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
    0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
    0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U
};

static uint32_t rotate_right(uint32_t value, unsigned int bits) {
    return (value >> bits) | (value << (32U - bits));
}

static void sha256_transform(sha256_context *context, const unsigned char block[64]) {
    uint32_t words[64];
    uint32_t a;
    uint32_t b;
    uint32_t c;
    uint32_t d;
    uint32_t e;
    uint32_t f;
    uint32_t g;
    uint32_t h;

    for (size_t index = 0; index < 16U; index += 1U) {
        size_t offset = index * 4U;
        words[index] = ((uint32_t)block[offset] << 24U)
            | ((uint32_t)block[offset + 1U] << 16U)
            | ((uint32_t)block[offset + 2U] << 8U)
            | (uint32_t)block[offset + 3U];
    }
    for (size_t index = 16U; index < 64U; index += 1U) {
        uint32_t s0 = rotate_right(words[index - 15U], 7U)
            ^ rotate_right(words[index - 15U], 18U)
            ^ (words[index - 15U] >> 3U);
        uint32_t s1 = rotate_right(words[index - 2U], 17U)
            ^ rotate_right(words[index - 2U], 19U)
            ^ (words[index - 2U] >> 10U);
        words[index] = words[index - 16U] + s0 + words[index - 7U] + s1;
    }

    a = context->state[0];
    b = context->state[1];
    c = context->state[2];
    d = context->state[3];
    e = context->state[4];
    f = context->state[5];
    g = context->state[6];
    h = context->state[7];
    for (size_t index = 0; index < 64U; index += 1U) {
        uint32_t sum1 = rotate_right(e, 6U) ^ rotate_right(e, 11U) ^ rotate_right(e, 25U);
        uint32_t choice = (e & f) ^ ((~e) & g);
        uint32_t temporary1 = h + sum1 + choice + sha256_constants[index] + words[index];
        uint32_t sum0 = rotate_right(a, 2U) ^ rotate_right(a, 13U) ^ rotate_right(a, 22U);
        uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        uint32_t temporary2 = sum0 + majority;
        h = g;
        g = f;
        f = e;
        e = d + temporary1;
        d = c;
        c = b;
        b = a;
        a = temporary1 + temporary2;
    }
    context->state[0] += a;
    context->state[1] += b;
    context->state[2] += c;
    context->state[3] += d;
    context->state[4] += e;
    context->state[5] += f;
    context->state[6] += g;
    context->state[7] += h;
}

static void sha256_init(sha256_context *context) {
    static const uint32_t initial_state[8] = {
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
        0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };
    memcpy(context->state, initial_state, sizeof(initial_state));
    context->bit_count = 0U;
    context->buffer_length = 0U;
}

static void sha256_update(sha256_context *context, const void *data, size_t length) {
    const unsigned char *bytes = data;
    context->bit_count += (uint64_t)length * 8U;
    while (length > 0U) {
        size_t available = 64U - context->buffer_length;
        size_t copied = length < available ? length : available;
        memcpy(context->buffer + context->buffer_length, bytes, copied);
        context->buffer_length += copied;
        bytes += copied;
        length -= copied;
        if (context->buffer_length == 64U) {
            sha256_transform(context, context->buffer);
            context->buffer_length = 0U;
        }
    }
}

static void sha256_final(sha256_context *context, unsigned char digest[32]) {
    uint64_t bit_count = context->bit_count;
    unsigned char marker = 0x80U;
    unsigned char zero = 0U;
    sha256_update(context, &marker, 1U);
    while (context->buffer_length != 56U) sha256_update(context, &zero, 1U);
    context->bit_count = bit_count;
    unsigned char length_bytes[8];
    for (size_t index = 0; index < 8U; index += 1U) {
        length_bytes[7U - index] = (unsigned char)(bit_count >> (index * 8U));
    }
    sha256_update(context, length_bytes, sizeof(length_bytes));
    for (size_t index = 0; index < 8U; index += 1U) {
        digest[index * 4U] = (unsigned char)(context->state[index] >> 24U);
        digest[index * 4U + 1U] = (unsigned char)(context->state[index] >> 16U);
        digest[index * 4U + 2U] = (unsigned char)(context->state[index] >> 8U);
        digest[index * 4U + 3U] = (unsigned char)context->state[index];
    }
}

static void digest_hex(const unsigned char digest[32], char output[SHA256_HEX_BYTES]) {
    static const char digits[] = "0123456789abcdef";
    for (size_t index = 0; index < 32U; index += 1U) {
        output[index * 2U] = digits[digest[index] >> 4U];
        output[index * 2U + 1U] = digits[digest[index] & 0x0fU];
    }
    output[64] = '\0';
}

static int emit_error(const char *reason) {
    printf("{\"protocol\":\"%s\",\"status\":\"blocked\",\"reason\":\"%s\"}\n",
           HELPER_PROTOCOL, reason);
    return 10;
}

static int emit_recovery_required(const char *reason) {
    printf("{\"protocol\":\"%s\",\"status\":\"recovery_required\",\"reason\":\"%s\"}\n",
           HELPER_PROTOCOL, reason);
    return 20;
}

static void crash_at_test_seam(const char *point) {
    const char *requested = getenv("SKILLS_REFINER_TEST_CRASH");
    if (requested != NULL && strcmp(requested, point) == 0) {
        (void)kill(getpid(), SIGKILL);
        _exit(127);
    }
}

static int fail_at_test_seam(const char *point) {
    const char *requested = getenv("SKILLS_REFINER_TEST_FAIL");
    return requested != NULL && strcmp(requested, point) == 0;
}

static int valid_utf8_without_control(const unsigned char *bytes, size_t length) {
    size_t index = 0U;
    while (index < length) {
        unsigned char first = bytes[index];
        if (first < 0x80U) {
            if (first < 0x20U || first == 0x7fU) return 0;
            index += 1U;
            continue;
        }
        size_t width;
        uint32_t codepoint;
        if ((first & 0xe0U) == 0xc0U) {
            width = 2U;
            codepoint = first & 0x1fU;
        } else if ((first & 0xf0U) == 0xe0U) {
            width = 3U;
            codepoint = first & 0x0fU;
        } else if ((first & 0xf8U) == 0xf0U) {
            width = 4U;
            codepoint = first & 0x07U;
        } else {
            return 0;
        }
        if (index + width > length) return 0;
        for (size_t offset = 1U; offset < width; offset += 1U) {
            unsigned char continuation = bytes[index + offset];
            if ((continuation & 0xc0U) != 0x80U) return 0;
            codepoint = (codepoint << 6U) | (continuation & 0x3fU);
        }
        if ((width == 2U && codepoint < 0x80U)
            || (width == 3U && codepoint < 0x800U)
            || (width == 4U && codepoint < 0x10000U)
            || codepoint > 0x10ffffU
            || (codepoint >= 0xd800U && codepoint <= 0xdfffU)) return 0;
        index += width;
    }
    return 1;
}

static int valid_component(const char *component) {
    size_t length = strlen(component);
    return length > 0U && strcmp(component, ".") != 0 && strcmp(component, "..") != 0
        && strchr(component, '/') == NULL
        && valid_utf8_without_control((const unsigned char *)component, length);
}

static int verify_directory_fd(int fd, int require_owner_only) {
    struct stat status;
    if (fstat(fd, &status) != 0 || !S_ISDIR(status.st_mode) || status.st_uid != getuid()) return -1;
    if ((status.st_mode & 0022) != 0) return -1;
    if (require_owner_only && (status.st_mode & 0777) != 0700) return -1;
    return 0;
}

static int open_absolute_directory(const char *path) {
    if (path == NULL || path[0] != '/' || !valid_utf8_without_control(
            (const unsigned char *)path, strlen(path))) return -1;
    char *copy = strdup(path);
    if (copy == NULL) return -1;
    int current = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (current < 0) {
        free(copy);
        return -1;
    }
    char *cursor = copy + 1;
    while (*cursor != '\0') {
        char *separator = strchr(cursor, '/');
        if (separator != NULL) *separator = '\0';
        if (!valid_component(cursor)) {
            close(current);
            free(copy);
            return -1;
        }
        int next = openat(current, cursor, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (next < 0) {
            close(current);
            free(copy);
            return -1;
        }
        close(current);
        current = next;
        if (separator == NULL) break;
        cursor = separator + 1;
        if (*cursor == '\0') {
            close(current);
            free(copy);
            return -1;
        }
    }
    free(copy);
    return current;
}

static const char *relative_to_home(const char *home, const char *path) {
    size_t home_length = strlen(home);
    if (strncmp(home, path, home_length) != 0 || path[home_length] != '/') return NULL;
    return path + home_length + 1U;
}

static int allowed_active_root(const char *home, const char *active_root) {
    static const char *allowed[] = {
        ".warp/skills",
        ".agents/skills",
        ".claude/skills",
        ".codex/skills",
        ".cursor/skills",
        ".cursor/skills-cursor",
        ".gemini/skills",
        ".copilot/skills",
        ".factory/skills",
        ".github/skills",
        ".opencode/skills"
    };
    for (size_t index = 0; index < sizeof(allowed) / sizeof(allowed[0]); index += 1U) {
        size_t expected_length = strlen(home) + 1U + strlen(allowed[index]);
        if (strlen(active_root) == expected_length
            && strncmp(active_root, home, strlen(home)) == 0
            && active_root[strlen(home)] == '/'
            && strcmp(active_root + strlen(home) + 1U, allowed[index]) == 0) return 1;
    }
    return 0;
}

static int open_relative_directory(int base_fd, const char *relative, int create, int owner_only) {
    if (relative == NULL || relative[0] == '/' || relative[0] == '\0') return -1;
    char *copy = strdup(relative);
    if (copy == NULL) return -1;
    int current = dup(base_fd);
    if (current < 0) {
        free(copy);
        return -1;
    }
    char *cursor = copy;
    while (*cursor != '\0') {
        char *separator = strchr(cursor, '/');
        if (separator != NULL) *separator = '\0';
        if (!valid_component(cursor)) {
            close(current);
            free(copy);
            return -1;
        }
        int created = 0;
        int next = openat(current, cursor, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (next < 0 && errno == ENOENT && create) {
            if (mkdirat(current, cursor, 0700) == 0) created = 1;
            else if (errno != EEXIST) {
                close(current);
                free(copy);
                return -1;
            }
            if (fsync(current) != 0) {
                close(current);
                free(copy);
                return -1;
            }
            next = openat(current, cursor, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        }
        if (next >= 0 && created && (fchmod(next, 0700) != 0 || fsync(next) != 0)) {
            close(next);
            close(current);
            free(copy);
            return -1;
        }
        if (next < 0 || verify_directory_fd(next, owner_only) != 0) {
            if (next >= 0) close(next);
            close(current);
            free(copy);
            return -1;
        }
        close(current);
        current = next;
        if (separator == NULL) break;
        cursor = separator + 1;
        if (*cursor == '\0') {
            close(current);
            free(copy);
            return -1;
        }
    }
    free(copy);
    return current;
}

static int open_private_agents_directory(int home_fd, const char *relative_after_agents, int create) {
    int agents_fd = open_relative_directory(home_fd, ".agents", create, 0);
    if (agents_fd < 0) return -1;
    int result = open_relative_directory(agents_fd, relative_after_agents, create, 1);
    close(agents_fd);
    return result;
}

static int split_immediate_child(const char *entry_path, const char *active_root,
                                 char leaf[NAME_MAX + 1U]) {
    size_t root_length = strlen(active_root);
    if (strncmp(entry_path, active_root, root_length) != 0 || entry_path[root_length] != '/') return -1;
    const char *candidate = entry_path + root_length + 1U;
    if (!valid_component(candidate) || strlen(candidate) > NAME_MAX) return -1;
    memcpy(leaf, candidate, strlen(candidate) + 1U);
    return 0;
}

static void hash_u64(sha256_context *context, uint64_t value) {
    unsigned char bytes[8];
    for (size_t index = 0; index < 8U; index += 1U) {
        bytes[7U - index] = (unsigned char)(value >> (index * 8U));
    }
    sha256_update(context, bytes, sizeof(bytes));
}

static void hash_bytes(sha256_context *context, const void *bytes, size_t length) {
    hash_u64(context, (uint64_t)length);
    sha256_update(context, bytes, length);
}

static uint32_t known_flag_mask(void) {
    uint32_t mask = 0U;
#ifdef UF_NODUMP
    mask |= UF_NODUMP;
#endif
#ifdef UF_IMMUTABLE
    mask |= UF_IMMUTABLE;
#endif
#ifdef UF_APPEND
    mask |= UF_APPEND;
#endif
#ifdef UF_OPAQUE
    mask |= UF_OPAQUE;
#endif
#ifdef UF_HIDDEN
    mask |= UF_HIDDEN;
#endif
#ifdef UF_COMPRESSED
    mask |= UF_COMPRESSED;
#endif
#ifdef UF_TRACKED
    mask |= UF_TRACKED;
#endif
#ifdef UF_DATAVAULT
    mask |= UF_DATAVAULT;
#endif
#ifdef UF_DATALESS
    mask |= UF_DATALESS;
#endif
#ifdef SF_ARCHIVED
    mask |= SF_ARCHIVED;
#endif
#ifdef SF_IMMUTABLE
    mask |= SF_IMMUTABLE;
#endif
#ifdef SF_APPEND
    mask |= SF_APPEND;
#endif
#ifdef SF_RESTRICTED
    mask |= SF_RESTRICTED;
#endif
#ifdef SF_NOUNLINK
    mask |= SF_NOUNLINK;
#endif
#ifdef SF_FIRMLINK
    mask |= SF_FIRMLINK;
#endif
    return mask;
}

static int flags_allow_mutation(uint32_t flags) {
    if ((flags & ~known_flag_mask()) != 0U) return 0;
    uint32_t blocked = 0U;
#ifdef UF_IMMUTABLE
    blocked |= UF_IMMUTABLE;
#endif
#ifdef UF_APPEND
    blocked |= UF_APPEND;
#endif
#ifdef SF_IMMUTABLE
    blocked |= SF_IMMUTABLE;
#endif
#ifdef SF_APPEND
    blocked |= SF_APPEND;
#endif
#ifdef SF_NOUNLINK
    blocked |= SF_NOUNLINK;
#endif
    return (flags & blocked) == 0U;
}

static int compare_names(const void *left, const void *right) {
    const char *const *left_name = left;
    const char *const *right_name = right;
    return strcmp(*left_name, *right_name);
}

static int same_object_snapshot(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev
        && left->st_ino == right->st_ino
        && left->st_mode == right->st_mode
        && left->st_uid == right->st_uid
        && left->st_gid == right->st_gid
        && left->st_size == right->st_size
        && left->st_flags == right->st_flags
        && left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec
        && left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec
        && left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec
        && left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}

static int hash_security_metadata(int fd, const struct stat *status,
                                  sha256_context *manifest, sha256_context *security,
                                  manifest_budget *budget) {
    hash_u64(manifest, (uint64_t)(status->st_mode & 07777));
    hash_u64(manifest, (uint64_t)status->st_uid);
    hash_u64(manifest, (uint64_t)status->st_gid);
    hash_u64(manifest, (uint64_t)status->st_flags);
    hash_u64(manifest, (uint64_t)status->st_dev);
    hash_u64(manifest, (uint64_t)status->st_ino);
    hash_u64(security, (uint64_t)(status->st_mode & 07777));
    hash_u64(security, (uint64_t)status->st_uid);
    hash_u64(security, (uint64_t)status->st_gid);
    hash_u64(security, (uint64_t)status->st_flags);
    if (!flags_allow_mutation((uint32_t)status->st_flags)) return -1;

    errno = 0;
    acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    if (acl == NULL) {
        if (errno != ENOENT) return -1;
        hash_bytes(manifest, "acl-empty", 9U);
        hash_bytes(security, "acl-empty", 9U);
    } else {
        ssize_t acl_length = acl_size(acl);
        if (acl_length < 0 || (size_t)acl_length > MAX_INPUT_BYTES) {
            acl_free(acl);
            return -1;
        }
        if (budget->metadata_bytes + (uint64_t)acl_length > MAX_METADATA_BYTES) {
            acl_free(acl);
            return -1;
        }
        budget->metadata_bytes += (uint64_t)acl_length;
        void *acl_bytes = malloc((size_t)acl_length);
        if (acl_bytes == NULL || acl_copy_ext(acl_bytes, acl, acl_length) != acl_length) {
            free(acl_bytes);
            acl_free(acl);
            return -1;
        }
        hash_bytes(manifest, acl_bytes, (size_t)acl_length);
        hash_bytes(security, acl_bytes, (size_t)acl_length);
        free(acl_bytes);
        acl_free(acl);
    }

    ssize_t names_length = flistxattr(fd, NULL, 0U, 0);
    if (names_length < 0 || (size_t)names_length > MAX_INPUT_BYTES) return -1;
    if (budget->metadata_bytes + (uint64_t)names_length > MAX_METADATA_BYTES) return -1;
    budget->metadata_bytes += (uint64_t)names_length;
    if (names_length == 0) {
        hash_bytes(manifest, "xattr-empty", 11U);
        hash_bytes(security, "xattr-empty", 11U);
        return 0;
    }
    char *names_buffer = malloc((size_t)names_length);
    if (names_buffer == NULL || flistxattr(fd, names_buffer, (size_t)names_length, 0) != names_length) {
        free(names_buffer);
        return -1;
    }
    size_t name_count = 0U;
    for (ssize_t index = 0; index < names_length;) {
        size_t remaining = (size_t)(names_length - index);
        size_t length = strnlen(names_buffer + index, remaining);
        if (length == 0U || length == remaining) {
            free(names_buffer);
            return -1;
        }
        name_count += 1U;
        index += (ssize_t)length + 1;
    }
    char **names = calloc(name_count, sizeof(*names));
    if (names == NULL) {
        free(names_buffer);
        return -1;
    }
    size_t name_index = 0U;
    for (ssize_t index = 0; index < names_length;) {
        names[name_index] = names_buffer + index;
        index += (ssize_t)strlen(names_buffer + index) + 1;
        name_index += 1U;
    }
    qsort(names, name_count, sizeof(*names), compare_names);
    for (size_t index = 0; index < name_count; index += 1U) {
        size_t name_length = strlen(names[index]);
        if (!valid_utf8_without_control((const unsigned char *)names[index], name_length)) {
            free(names);
            free(names_buffer);
            return -1;
        }
        ssize_t value_length = fgetxattr(fd, names[index], NULL, 0U, 0U, 0);
        if (value_length < 0 || (size_t)value_length > MAX_INPUT_BYTES) {
            free(names);
            free(names_buffer);
            return -1;
        }
        if (budget->metadata_bytes + (uint64_t)value_length > MAX_METADATA_BYTES) {
            free(names);
            free(names_buffer);
            return -1;
        }
        budget->metadata_bytes += (uint64_t)value_length;
        void *value = malloc(value_length == 0 ? 1U : (size_t)value_length);
        if (value == NULL || fgetxattr(fd, names[index], value, (size_t)value_length, 0U, 0) != value_length) {
            free(value);
            free(names);
            free(names_buffer);
            return -1;
        }
        hash_bytes(manifest, names[index], name_length);
        hash_bytes(manifest, value, (size_t)value_length);
        hash_bytes(security, names[index], name_length);
        hash_bytes(security, value, (size_t)value_length);
        free(value);
    }
    free(names);
    free(names_buffer);
    return 0;
}

static int hash_file_content(int fd, sha256_context *manifest, manifest_budget *budget,
                             off_t expected_size) {
    if (expected_size < 0 || (uint64_t)expected_size > MAX_MANIFEST_BYTES
        || budget->content_bytes + (uint64_t)expected_size > MAX_MANIFEST_BYTES) return -1;
    budget->content_bytes += (uint64_t)expected_size;
    unsigned char buffer[32768];
    uint64_t observed_size = 0U;
    if (lseek(fd, 0, SEEK_SET) < 0) return -1;
    for (;;) {
        ssize_t bytes_read = read(fd, buffer, sizeof(buffer));
        if (bytes_read < 0) return -1;
        if (bytes_read == 0) break;
        observed_size += (uint64_t)bytes_read;
        if (observed_size > (uint64_t)expected_size) return -1;
        sha256_update(manifest, buffer, (size_t)bytes_read);
    }
    return observed_size == (uint64_t)expected_size ? 0 : -1;
}

static int hash_tree(int directory_fd, const char *relative_prefix, dev_t expected_device,
                     sha256_context *manifest, sha256_context *security,
                     manifest_budget *budget, unsigned int depth);

static int hash_child(int parent_fd, const char *name, const char *relative_path,
                      dev_t expected_device, sha256_context *manifest, sha256_context *security,
                      manifest_budget *budget, unsigned int depth) {
    budget->objects += 1U;
    if (budget->objects > MAX_MANIFEST_OBJECTS || depth > MAX_MANIFEST_DEPTH) return -1;
    struct stat before;
    if (fstatat(parent_fd, name, &before, AT_SYMLINK_NOFOLLOW) != 0 || before.st_dev != expected_device) return -1;
    hash_bytes(manifest, relative_path, strlen(relative_path));
    int child_fd = -1;
    const char *kind = NULL;
    if (S_ISDIR(before.st_mode)) {
        kind = "directory";
        child_fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    } else if (S_ISREG(before.st_mode)) {
        kind = "file";
        if ((before.st_mode & 0444) == 0) return -1;
        child_fd = openat(parent_fd, name, O_RDONLY | O_NOFOLLOW);
    } else if (S_ISLNK(before.st_mode)) {
        kind = "symlink";
        child_fd = openat(parent_fd, name, O_RDONLY | O_SYMLINK);
    } else {
        return -1;
    }
    if (child_fd < 0) return -1;
    struct stat opened;
    if (fstat(child_fd, &opened) != 0 || !same_object_snapshot(&before, &opened)) {
        close(child_fd);
        return -1;
    }
    hash_bytes(manifest, kind, strlen(kind));
    if (hash_security_metadata(child_fd, &opened, manifest, security, budget) != 0) {
        close(child_fd);
        return -1;
    }
    int result = 0;
    if (S_ISDIR(opened.st_mode)) {
        result = hash_tree(child_fd, relative_path, expected_device, manifest, security, budget, depth);
    } else if (S_ISREG(opened.st_mode)) {
        hash_u64(manifest, (uint64_t)opened.st_size);
        result = hash_file_content(child_fd, manifest, budget, opened.st_size);
    } else {
        char target[PATH_MAX + 1U];
        ssize_t target_length = readlinkat(parent_fd, name, target, PATH_MAX);
        if (target_length < 0 || (size_t)target_length > PATH_MAX) result = -1;
        else hash_bytes(manifest, target, (size_t)target_length);
    }
    struct stat after;
    struct stat path_after;
    if (result == 0 && (fstat(child_fd, &after) != 0
        || fstatat(parent_fd, name, &path_after, AT_SYMLINK_NOFOLLOW) != 0
        || !same_object_snapshot(&opened, &after)
        || !same_object_snapshot(&opened, &path_after))) result = -1;
    close(child_fd);
    return result;
}

static int hash_tree(int directory_fd, const char *relative_prefix, dev_t expected_device,
                     sha256_context *manifest, sha256_context *security,
                     manifest_budget *budget, unsigned int depth) {
    if (depth >= MAX_MANIFEST_DEPTH) return -1;
    struct stat directory_before;
    if (fstat(directory_fd, &directory_before) != 0) return -1;
    int listing_fd = dup(directory_fd);
    if (listing_fd < 0) return -1;
    DIR *directory = fdopendir(listing_fd);
    if (directory == NULL) {
        close(listing_fd);
        return -1;
    }
    char **names = NULL;
    size_t count = 0U;
    size_t capacity = 0U;
    errno = 0;
    struct dirent *item;
    while ((item = readdir(directory)) != NULL) {
        if (strcmp(item->d_name, ".") == 0 || strcmp(item->d_name, "..") == 0) continue;
        if (strcmp(item->d_name, ".git") == 0) {
            closedir(directory);
            for (size_t index = 0; index < count; index += 1U) free(names[index]);
            free(names);
            return -2;
        }
        if (!valid_component(item->d_name)) {
            closedir(directory);
            for (size_t index = 0; index < count; index += 1U) free(names[index]);
            free(names);
            return -1;
        }
        if (count >= MAX_MANIFEST_OBJECTS
            || budget->objects > MAX_MANIFEST_OBJECTS - count - 1U) {
            closedir(directory);
            for (size_t index = 0; index < count; index += 1U) free(names[index]);
            free(names);
            return -1;
        }
        if (count == capacity) {
            size_t next_capacity = capacity == 0U ? 16U : capacity * 2U;
            char **next = realloc(names, next_capacity * sizeof(*names));
            if (next == NULL) {
                closedir(directory);
                for (size_t index = 0; index < count; index += 1U) free(names[index]);
                free(names);
                return -1;
            }
            names = next;
            capacity = next_capacity;
        }
        names[count] = strdup(item->d_name);
        if (names[count] == NULL) {
            closedir(directory);
            for (size_t index = 0; index < count; index += 1U) free(names[index]);
            free(names);
            return -1;
        }
        count += 1U;
    }
    if (errno != 0) {
        closedir(directory);
        for (size_t index = 0; index < count; index += 1U) free(names[index]);
        free(names);
        return -1;
    }
    closedir(directory);
    qsort(names, count, sizeof(*names), compare_names);
    int result = 0;
    for (size_t index = 0; index < count; index += 1U) {
        char relative_path[PATH_MAX + 1U];
        int length = relative_prefix[0] == '\0'
            ? snprintf(relative_path, sizeof(relative_path), "%s", names[index])
            : snprintf(relative_path, sizeof(relative_path), "%s/%s", relative_prefix, names[index]);
        int child_result = length < 0 || (size_t)length >= sizeof(relative_path)
            ? -1
            : hash_child(directory_fd, names[index], relative_path, expected_device, manifest, security,
                         budget, depth + 1U);
        if (child_result != 0) {
            result = child_result;
            break;
        }
    }
    for (size_t index = 0; index < count; index += 1U) free(names[index]);
    free(names);
    struct stat directory_after;
    if (result == 0 && (fstat(directory_fd, &directory_after) != 0
        || !same_object_snapshot(&directory_before, &directory_after))) result = -1;
    return result;
}

static char *base64_encode(const unsigned char *bytes, size_t length) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t output_length = ((length + 2U) / 3U) * 4U;
    char *output = malloc(output_length + 1U);
    if (output == NULL) return NULL;
    size_t input_index = 0U;
    size_t output_index = 0U;
    while (input_index < length) {
        uint32_t value = (uint32_t)bytes[input_index++] << 16U;
        int have_second = input_index < length;
        if (have_second) value |= (uint32_t)bytes[input_index++] << 8U;
        int have_third = input_index < length;
        if (have_third) value |= bytes[input_index++];
        output[output_index++] = alphabet[(value >> 18U) & 0x3fU];
        output[output_index++] = alphabet[(value >> 12U) & 0x3fU];
        output[output_index++] = have_second ? alphabet[(value >> 6U) & 0x3fU] : '=';
        output[output_index++] = have_third ? alphabet[value & 0x3fU] : '=';
    }
    output[output_length] = '\0';
    return output;
}

typedef struct {
    const char *kind;
    struct stat snapshot;
    char manifest_hex[SHA256_HEX_BYTES];
    char security_hex[SHA256_HEX_BYTES];
    char *raw_target_base64;
} entry_identity;

enum identity_result {
    IDENTITY_OK = 0,
    IDENTITY_UNSUPPORTED = 1,
    IDENTITY_UNAVAILABLE = 2,
    IDENTITY_CHANGED = 3,
    IDENTITY_BLOCKED = 4,
    IDENTITY_AUTHORING_SOURCE = 5
};

static enum identity_result calculate_entry_identity(int root_fd, const char *leaf,
                                                     const struct stat *leaf_status,
                                                     entry_identity *identity) {
    memset(identity, 0, sizeof(*identity));
    int entry_fd;
    if (S_ISDIR(leaf_status->st_mode)) {
        identity->kind = "directory";
        entry_fd = openat(root_fd, leaf, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    } else if (S_ISLNK(leaf_status->st_mode)) {
        identity->kind = "symlink";
        entry_fd = openat(root_fd, leaf, O_RDONLY | O_SYMLINK);
    } else {
        return IDENTITY_UNSUPPORTED;
    }
    if (entry_fd < 0) return IDENTITY_UNAVAILABLE;
    if (fstat(entry_fd, &identity->snapshot) != 0
        || !same_object_snapshot(leaf_status, &identity->snapshot)) {
        close(entry_fd);
        return IDENTITY_CHANGED;
    }

    sha256_context manifest;
    sha256_context security;
    manifest_budget budget = {0U, 0U, 1U};
    sha256_init(&manifest);
    sha256_init(&security);
    hash_bytes(&manifest, identity->kind, strlen(identity->kind));
    int result = hash_security_metadata(
        entry_fd,
        &identity->snapshot,
        &manifest,
        &security,
        &budget
    );
    if (result == 0 && S_ISDIR(identity->snapshot.st_mode)) {
        result = hash_tree(
            entry_fd,
            "",
            identity->snapshot.st_dev,
            &manifest,
            &security,
            &budget,
            0U
        );
    } else if (result == 0) {
        unsigned char target[PATH_MAX + 1U];
        ssize_t target_length = readlinkat(root_fd, leaf, (char *)target, PATH_MAX);
        if (target_length < 0 || (size_t)target_length > PATH_MAX) result = -1;
        else {
            hash_bytes(&manifest, target, (size_t)target_length);
            identity->raw_target_base64 = base64_encode(target, (size_t)target_length);
            if (identity->raw_target_base64 == NULL) result = -1;
        }
    }
    struct stat after;
    struct stat path_after;
    if (result == 0 && (fstat(entry_fd, &after) != 0
        || fstatat(root_fd, leaf, &path_after, AT_SYMLINK_NOFOLLOW) != 0
        || !same_object_snapshot(&identity->snapshot, &after)
        || !same_object_snapshot(&identity->snapshot, &path_after))) result = -1;
    close(entry_fd);
    if (result != 0) {
        free(identity->raw_target_base64);
        identity->raw_target_base64 = NULL;
        if (result == -2) return IDENTITY_AUTHORING_SOURCE;
        return IDENTITY_BLOCKED;
    }
    unsigned char manifest_digest[32];
    unsigned char security_digest[32];
    sha256_final(&manifest, manifest_digest);
    sha256_final(&security, security_digest);
    digest_hex(manifest_digest, identity->manifest_hex);
    digest_hex(security_digest, identity->security_hex);
    return IDENTITY_OK;
}

static int inspect_entry(const char *home_path, const char *active_root, const char *entry_path) {
    char leaf[NAME_MAX + 1U];
    if (!allowed_active_root(home_path, active_root)
        || split_immediate_child(entry_path, active_root, leaf) != 0) {
        return emit_error("not_immediate_child");
    }
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    const char *root_relative = relative_to_home(home_path, active_root);
    int root_fd = root_relative == NULL ? -1 : open_relative_directory(home_fd, root_relative, 0, 0);
    if (root_fd < 0) {
        close(home_fd);
        return emit_error("unsafe_active_root");
    }
    struct stat home_status;
    struct stat root_status;
    if (fstat(home_fd, &home_status) != 0 || fstat(root_fd, &root_status) != 0
        || home_status.st_dev != root_status.st_dev) {
        close(root_fd);
        close(home_fd);
        return emit_error("unexpected_active_root_mount");
    }
    struct stat leaf_status;
    if (fstatat(root_fd, leaf, &leaf_status, AT_SYMLINK_NOFOLLOW) != 0) {
        close(root_fd);
        close(home_fd);
        return emit_error("entry_unavailable");
    }
    entry_identity identity;
    enum identity_result result = calculate_entry_identity(root_fd, leaf, &leaf_status, &identity);
    close(root_fd);
    close(home_fd);
    if (result == IDENTITY_UNSUPPORTED) return emit_error("unsupported_entry_kind");
    if (result == IDENTITY_UNAVAILABLE) return emit_error("entry_unavailable");
    if (result == IDENTITY_CHANGED) return emit_error("identity_changed");
    if (result == IDENTITY_AUTHORING_SOURCE) return emit_error("authoring_source");
    if (result != IDENTITY_OK) return emit_error("metadata_or_tree_blocked");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"inspect\","
           "\"entry_kind\":\"%s\",\"device\":\"%llu\",\"inode\":\"%llu\","
           "\"mode\":%u,\"uid\":%u,\"gid\":%u,\"flags\":%u,"
           "\"manifest_hash\":\"sha256:%s\",\"security_metadata_hash\":\"sha256:%s\","
           "\"raw_link_target_base64\":",
           HELPER_PROTOCOL, identity.kind, (unsigned long long)identity.snapshot.st_dev,
           (unsigned long long)identity.snapshot.st_ino,
           (unsigned int)(identity.snapshot.st_mode & 07777),
           (unsigned int)identity.snapshot.st_uid, (unsigned int)identity.snapshot.st_gid,
           (unsigned int)identity.snapshot.st_flags, identity.manifest_hex, identity.security_hex);
    if (identity.raw_target_base64 == NULL) printf("null");
    else printf("\"%s\"", identity.raw_target_base64);
    printf("}\n");
    free(identity.raw_target_base64);
    return 0;
}

static int hash_regular_fd(int fd, char output[SHA256_HEX_BYTES], size_t maximum) {
    struct stat before;
    if (fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) || before.st_uid != getuid()
        || (before.st_mode & 0022) != 0 || before.st_size < 0 || (uint64_t)before.st_size > maximum) return -1;
    sha256_context context;
    sha256_init(&context);
    unsigned char buffer[32768];
    if (lseek(fd, 0, SEEK_SET) < 0) return -1;
    for (;;) {
        ssize_t count = read(fd, buffer, sizeof(buffer));
        if (count < 0) return -1;
        if (count == 0) break;
        sha256_update(&context, buffer, (size_t)count);
    }
    struct stat after;
    if (fstat(fd, &after) != 0 || !same_object_snapshot(&before, &after)) return -1;
    unsigned char digest[32];
    sha256_final(&context, digest);
    digest_hex(digest, output);
    return 0;
}

static int read_regular_fd_bounded(int fd, unsigned char **bytes, size_t *length,
                                   char output[SHA256_HEX_BYTES], size_t maximum) {
    struct stat before;
    if (fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) || before.st_uid != getuid()
        || (before.st_mode & 0022) != 0 || before.st_size < 0
        || (uint64_t)before.st_size > maximum) return -1;
    size_t expected = (size_t)before.st_size;
    unsigned char *buffer = malloc(expected + 1U);
    if (buffer == NULL || lseek(fd, 0, SEEK_SET) < 0) {
        free(buffer);
        return -1;
    }
    size_t observed = 0U;
    while (observed < expected) {
        ssize_t count = read(fd, buffer + observed, expected - observed);
        if (count <= 0) {
            free(buffer);
            return -1;
        }
        observed += (size_t)count;
    }
    unsigned char extra;
    if (read(fd, &extra, 1U) != 0) {
        free(buffer);
        return -1;
    }
    struct stat after;
    if (fstat(fd, &after) != 0 || !same_object_snapshot(&before, &after)) {
        free(buffer);
        return -1;
    }
    sha256_context context;
    unsigned char digest[32];
    sha256_init(&context);
    sha256_update(&context, buffer, expected);
    sha256_final(&context, digest);
    digest_hex(digest, output);
    *bytes = buffer;
    *length = expected;
    return 0;
}

static int hash_install_receipt_from_home_fd(int home_fd, char digest[SHA256_HEX_BYTES]) {
    int agents_fd = open_relative_directory(home_fd, ".agents", 0, 0);
    if (agents_fd < 0) return -1;
    int receipt_fd = openat(agents_fd, ".skill-lock.json", O_RDONLY | O_NOFOLLOW);
    if (receipt_fd < 0) {
        close(agents_fd);
        return -1;
    }
    int result = hash_regular_fd(receipt_fd, digest, MAX_INPUT_BYTES);
    close(receipt_fd);
    close(agents_fd);
    return result;
}

static int hash_install_receipt(const char *home_path) {
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    int agents_fd = open_relative_directory(home_fd, ".agents", 0, 0);
    int receipt_fd = agents_fd < 0
        ? -1
        : openat(agents_fd, ".skill-lock.json", O_RDONLY | O_NOFOLLOW);
    unsigned char *bytes = NULL;
    size_t length = 0U;
    char digest[SHA256_HEX_BYTES];
    int result = receipt_fd < 0
        ? -1
        : read_regular_fd_bounded(receipt_fd, &bytes, &length, digest, MAX_INPUT_BYTES);
    if (receipt_fd >= 0) close(receipt_fd);
    if (agents_fd >= 0) close(agents_fd);
    close(home_fd);
    if (result != 0) return emit_error("receipt_unsafe");
    char *encoded = base64_encode(bytes, length);
    free(bytes);
    if (encoded == NULL) return emit_error("receipt_unsafe");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"hash-install-receipt\","
           "\"receipt_sha256\":\"%s\",\"receipt_base64\":\"%s\"}\n",
           HELPER_PROTOCOL, digest, encoded);
    free(encoded);
    return 0;
}

static int copy_fd(int source_fd, int destination_fd) {
    unsigned char buffer[32768];
    if (lseek(source_fd, 0, SEEK_SET) < 0) return -1;
    for (;;) {
        ssize_t count = read(source_fd, buffer, sizeof(buffer));
        if (count < 0) return -1;
        if (count == 0) break;
        size_t written = 0U;
        while (written < (size_t)count) {
            ssize_t part = write(destination_fd, buffer + written, (size_t)count - written);
            if (part <= 0) return -1;
            written += (size_t)part;
        }
    }
    return 0;
}

static int install_self(const char *home_path, const char *architecture,
                        const char *expected_binary_hash, const char *executable_path) {
    if (!valid_component(architecture) || strlen(expected_binary_hash) != 64U) return emit_error("invalid_install_identity");
    int source_fd = open(executable_path, O_RDONLY | O_NOFOLLOW);
    char source_hash[SHA256_HEX_BYTES];
    if (source_fd < 0 || hash_regular_fd(source_fd, source_hash, 64U * 1024U * 1024U) != 0
        || strcmp(source_hash, expected_binary_hash) != 0) {
        if (source_fd >= 0) close(source_fd);
        return emit_error("bootstrap_identity_mismatch");
    }
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        close(source_fd);
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    char cache_relative[PATH_MAX + 1U];
    int cache_length = snprintf(cache_relative, sizeof(cache_relative),
        "skills-refiner/runtime/macos/%s/%s", architecture, expected_binary_hash);
    int cache_fd = cache_length < 0 || (size_t)cache_length >= sizeof(cache_relative)
        ? -1 : open_private_agents_directory(home_fd, cache_relative, 1);
    if (cache_fd < 0) {
        close(home_fd);
        close(source_fd);
        return emit_error("runtime_cache_unsafe");
    }
    const char *leaf = "cleanup-macos-helper";
    int existing_fd = openat(cache_fd, leaf, O_RDONLY | O_NOFOLLOW);
    if (existing_fd >= 0) {
        char existing_hash[SHA256_HEX_BYTES];
        struct stat existing;
        int valid = fstat(existing_fd, &existing) == 0 && (existing.st_mode & 0777) == 0700
            && hash_regular_fd(existing_fd, existing_hash, 64U * 1024U * 1024U) == 0
            && strcmp(existing_hash, expected_binary_hash) == 0;
        close(existing_fd);
        close(cache_fd);
        close(home_fd);
        close(source_fd);
        if (!valid) return emit_error("runtime_cache_tampered");
    } else {
        char temporary[NAME_MAX + 1U];
        int temporary_length = snprintf(temporary, sizeof(temporary), ".skills-refiner-install-%ld-%08x",
            (long)getpid(), arc4random());
        if (temporary_length < 0 || (size_t)temporary_length >= sizeof(temporary)) {
            close(cache_fd);
            close(home_fd);
            close(source_fd);
            return emit_error("runtime_cache_unsafe");
        }
        int destination_fd = openat(cache_fd, temporary, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0700);
        if (destination_fd < 0 || fchmod(destination_fd, 0700) != 0
            || copy_fd(source_fd, destination_fd) != 0
            || fsync(destination_fd) != 0 || close(destination_fd) != 0
            || renameatx_np(cache_fd, temporary, cache_fd, leaf, RENAME_EXCL) != 0
            || fsync(cache_fd) != 0) {
            if (destination_fd >= 0) close(destination_fd);
            unlinkat(cache_fd, temporary, 0);
            close(cache_fd);
            close(home_fd);
            close(source_fd);
            return emit_error("runtime_cache_publish_failed");
        }
        close(cache_fd);
        close(home_fd);
        close(source_fd);
    }
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"install-self\","
           "\"architecture\":\"%s\",\"binary_sha256\":\"%s\"}\n",
           HELPER_PROTOCOL, architecture, expected_binary_hash);
    return 0;
}

static const char *role_root(const char *role) {
    if (strcmp(role, "cleanup") == 0) return "skills-refiner/cleanup";
    if (strcmp(role, "quarantine") == 0) return "skills-quarantine";
    return NULL;
}

static int read_bounded_stdin(unsigned char **output, size_t *output_length) {
    unsigned char *buffer = malloc(MAX_INPUT_BYTES + 1U);
    if (buffer == NULL) return -1;
    size_t length = 0U;
    while (length <= MAX_INPUT_BYTES) {
        ssize_t count = read(STDIN_FILENO, buffer + length, MAX_INPUT_BYTES + 1U - length);
        if (count < 0) {
            free(buffer);
            return -1;
        }
        if (count == 0) break;
        length += (size_t)count;
    }
    if (length > MAX_INPUT_BYTES) {
        free(buffer);
        return -1;
    }
    *output = buffer;
    *output_length = length;
    return 0;
}

static int publish_state(const char *home_path, const char *role,
                         const char *relative_directory, const char *leaf) {
    const char *root_relative = role_root(role);
    if (root_relative == NULL || !valid_component(leaf)) return emit_error("invalid_state_destination");
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    int root_fd = open_private_agents_directory(home_fd, root_relative, 1);
    int directory_fd = root_fd;
    if (root_fd >= 0 && strcmp(relative_directory, ".") != 0) {
        directory_fd = open_relative_directory(root_fd, relative_directory, 1, 1);
        close(root_fd);
    }
    close(home_fd);
    if (directory_fd < 0) return emit_error("unsafe_state_destination");
    struct stat existing;
    int existing_result = fstatat(directory_fd, leaf, &existing, AT_SYMLINK_NOFOLLOW);
    if ((existing_result == 0
         && (!S_ISREG(existing.st_mode) || existing.st_uid != getuid() || (existing.st_mode & 0077) != 0))
        || (existing_result != 0 && errno != ENOENT)) {
        close(directory_fd);
        return emit_error("unsafe_state_destination");
    }
    unsigned char *bytes = NULL;
    size_t length = 0U;
    if (read_bounded_stdin(&bytes, &length) != 0) {
        close(directory_fd);
        return emit_error("state_input_invalid");
    }
    char temporary[NAME_MAX + 1U];
    int temporary_length = snprintf(temporary, sizeof(temporary), ".skills-refiner-state-%ld-%08x",
        (long)getpid(), arc4random());
    int temporary_fd = temporary_length < 0 || (size_t)temporary_length >= sizeof(temporary)
        ? -1 : openat(directory_fd, temporary, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
    int temporary_created = temporary_fd >= 0;
    int result = 0;
    int published = 0;
    if (temporary_fd < 0 || fchmod(temporary_fd, 0600) != 0) result = -1;
    size_t written = 0U;
    while (result == 0 && written < length) {
        ssize_t part = write(temporary_fd, bytes + written, length - written);
        if (part <= 0) result = -1;
        else written += (size_t)part;
    }
    if (result == 0) {
        int file_durable = !fail_at_test_seam("state_file_fsync")
            && fsync(temporary_fd) == 0;
        int file_closed = close(temporary_fd) == 0;
        if (!file_durable || !file_closed) result = -1;
    } else if (temporary_fd >= 0) {
        close(temporary_fd);
    }
    if (result == 0 && renameat(directory_fd, temporary, directory_fd, leaf) != 0) result = -1;
    else if (result == 0) {
        published = 1;
        crash_at_test_seam("after_state_rename");
    }
    if (result == 0
        && (fail_at_test_seam("state_parent_fsync") || fsync(directory_fd) != 0)) result = -1;
    if (result != 0 && temporary_created && !published) unlinkat(directory_fd, temporary, 0);
    free(bytes);
    close(directory_fd);
    if (result != 0 && published) return emit_recovery_required("state_durability_unknown");
    if (result != 0) return emit_error("state_publish_failed");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"publish-state\"}\n",
           HELPER_PROTOCOL);
    return 0;
}

static int valid_sha256_identifier(const char *value) {
    if (value == NULL || strlen(value) != 71U || strncmp(value, "sha256:", 7U) != 0) return 0;
    for (size_t index = 7U; index < 71U; index += 1U) {
        if (!((value[index] >= '0' && value[index] <= '9')
              || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
    }
    return 1;
}

static int valid_lower_hex(const char *value, size_t expected_length) {
    if (value == NULL || strlen(value) != expected_length) return 0;
    for (size_t index = 0U; index < expected_length; index += 1U) {
        if (!((value[index] >= '0' && value[index] <= '9')
              || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
    }
    return 1;
}

static int write_new_record(int directory_fd, const char *leaf,
                            const unsigned char *bytes, size_t length) {
    int fd = openat(directory_fd, leaf, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
    if (fd < 0 || fchmod(fd, 0600) != 0) {
        if (fd >= 0) close(fd);
        return -1;
    }
    size_t written = 0U;
    int result = 0;
    while (written < length) {
        ssize_t part = write(fd, bytes + written, length - written);
        if (part <= 0) {
            result = -1;
            break;
        }
        written += (size_t)part;
    }
    int durable = fsync(fd) == 0;
    int closed = close(fd) == 0;
    if (!durable || !closed) result = -1;
    if (result != 0) unlinkat(directory_fd, leaf, 0);
    return result;
}

static void remove_transaction_temporary(int transactions_fd, const char *temporary) {
    int temporary_fd = openat(transactions_fd, temporary, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (temporary_fd < 0) return;
    unlinkat(temporary_fd, "plan.json", 0);
    unlinkat(temporary_fd, "manifest.json", 0);
    unlinkat(temporary_fd, "state.json", 0);
    unlinkat(temporary_fd, "events.jsonl", 0);
    unlinkat(temporary_fd, "payload", AT_REMOVEDIR);
    close(temporary_fd);
    unlinkat(transactions_fd, temporary, AT_REMOVEDIR);
}

static int split_transaction_records(unsigned char *bytes, size_t length,
                                     unsigned char *records[3], size_t lengths[3]) {
    size_t start = 0U;
    size_t record = 0U;
    for (size_t index = 0U; index < length; index += 1U) {
        if (bytes[index] != '\n') continue;
        if (record >= 3U || index == start) return -1;
        records[record] = bytes + start;
        lengths[record] = index - start;
        record += 1U;
        start = index + 1U;
    }
    return record == 3U && start == length ? 0 : -1;
}

static int transaction_init(const char *home_path, const char *transaction_id) {
    if (!valid_sha256_identifier(transaction_id)) return emit_error("invalid_transaction_id");
    const char *storage_key = transaction_id + 7U;
    unsigned char *bytes = NULL;
    size_t length = 0U;
    if (read_bounded_stdin(&bytes, &length) != 0) return emit_error("transaction_input_invalid");
    unsigned char *records[3];
    size_t lengths[3];
    if (split_transaction_records(bytes, length, records, lengths) != 0) {
        free(bytes);
        return emit_error("transaction_input_invalid");
    }
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        free(bytes);
        return emit_error("unsafe_home");
    }
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 1);
    int transactions_fd = quarantine_fd < 0
        ? -1
        : open_relative_directory(quarantine_fd, "transactions", 1, 1);
    if (quarantine_fd >= 0) close(quarantine_fd);
    close(home_fd);
    if (transactions_fd < 0) {
        free(bytes);
        return emit_error("unsafe_transaction_root");
    }
    char temporary[NAME_MAX + 1U];
    int temporary_length = snprintf(temporary, sizeof(temporary), ".skills-refiner-tx-%ld-%08x",
        (long)getpid(), arc4random());
    int result = temporary_length < 0 || (size_t)temporary_length >= sizeof(temporary)
        ? -1
        : mkdirat(transactions_fd, temporary, 0700);
    int temporary_fd = result == 0
        ? openat(transactions_fd, temporary, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        : -1;
    if (temporary_fd < 0 || fchmod(temporary_fd, 0700) != 0) result = -1;
    int payload_fd = result == 0 && mkdirat(temporary_fd, "payload", 0700) == 0
        ? openat(temporary_fd, "payload", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        : -1;
    if (payload_fd < 0 || fchmod(payload_fd, 0700) != 0 || fsync(payload_fd) != 0) result = -1;
    if (payload_fd >= 0) close(payload_fd);
    if (result == 0 && write_new_record(temporary_fd, "plan.json", records[0], lengths[0]) != 0) result = -1;
    if (result == 0 && write_new_record(temporary_fd, "manifest.json", records[1], lengths[1]) != 0) result = -1;
    if (result == 0 && write_new_record(temporary_fd, "state.json", records[2], lengths[2]) != 0) result = -1;
    if (result == 0 && write_new_record(temporary_fd, "events.jsonl", (const unsigned char *)"", 0U) != 0) {
        result = -1;
    }
    if (result == 0 && fsync(temporary_fd) != 0) result = -1;
    if (temporary_fd >= 0) close(temporary_fd);
    free(bytes);
    if (result != 0) {
        remove_transaction_temporary(transactions_fd, temporary);
        close(transactions_fd);
        return emit_error("transaction_init_failed");
    }
    crash_at_test_seam("before_transaction_publish");
    int renamed = renameatx_np(
        transactions_fd,
        temporary,
        transactions_fd,
        storage_key,
        RENAME_EXCL
    );
    int rename_errno = errno;
    if (renamed != 0) {
        remove_transaction_temporary(transactions_fd, temporary);
        close(transactions_fd);
        if (rename_errno == EEXIST) {
            printf("{\"protocol\":\"%s\",\"status\":\"ok\","
                   "\"operation\":\"transaction-init\",\"result\":\"existing\"}\n",
                   HELPER_PROTOCOL);
            return 0;
        }
        return emit_error("transaction_publish_failed");
    }
    crash_at_test_seam("after_transaction_publish");
    int durable = fsync(transactions_fd) == 0;
    close(transactions_fd);
    if (!durable) return emit_recovery_required("transaction_durability_unknown");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\","
           "\"operation\":\"transaction-init\",\"result\":\"created\"}\n",
           HELPER_PROTOCOL);
    return 0;
}

static int read_transaction_record(int transaction_fd, const char *leaf,
                                   unsigned char **bytes, size_t *length) {
    int fd = openat(transaction_fd, leaf, O_RDONLY | O_NOFOLLOW);
    struct stat status;
    char digest[SHA256_HEX_BYTES];
    if (fd < 0 || fstat(fd, &status) != 0 || (status.st_mode & 0777) != 0600
        || read_regular_fd_bounded(fd, bytes, length, digest, MAX_INPUT_BYTES) != 0) {
        if (fd >= 0) close(fd);
        return -1;
    }
    close(fd);
    return 0;
}

static int read_lock_owner(int quarantine_fd, unsigned char **bytes, size_t *length);

static int probe_transaction(const char *home_path, const char *transaction_id) {
    if (!valid_sha256_identifier(transaction_id)) return emit_error("invalid_transaction_id");
    const char *storage_key = transaction_id + 7U;
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 0);
    int transactions_fd = quarantine_fd < 0
        ? -1
        : open_relative_directory(quarantine_fd, "transactions", 0, 1);
    int transaction_fd = transactions_fd < 0
        ? -1
        : openat(transactions_fd, storage_key, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (transactions_fd >= 0) close(transactions_fd);
    close(home_fd);
    if (transaction_fd < 0 || verify_directory_fd(transaction_fd, 1) != 0) {
        if (transaction_fd >= 0) close(transaction_fd);
        if (quarantine_fd >= 0) close(quarantine_fd);
        return emit_error("transaction_unavailable");
    }
    int payload_fd = openat(transaction_fd, "payload", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (payload_fd < 0 || verify_directory_fd(payload_fd, 1) != 0) {
        if (payload_fd >= 0) close(payload_fd);
        close(transaction_fd);
        close(quarantine_fd);
        return emit_recovery_required("transaction_records_unavailable");
    }
    close(payload_fd);
    const char *leaves[3] = {"plan.json", "manifest.json", "state.json"};
    unsigned char *records[3] = {NULL, NULL, NULL};
    size_t lengths[3] = {0U, 0U, 0U};
    size_t total = 0U;
    int result = 0;
    for (size_t index = 0U; index < 3U; index += 1U) {
        if (read_transaction_record(transaction_fd, leaves[index], &records[index], &lengths[index]) != 0
            || lengths[index] > MAX_INPUT_BYTES - total) {
            result = -1;
            break;
        }
        total += lengths[index];
    }
    unsigned char *lock_owner = NULL;
    size_t lock_owner_length = 0U;
    int have_lock = 0;
    struct stat lock_status;
    if (result == 0 && fstatat(quarantine_fd, "lock", &lock_status, AT_SYMLINK_NOFOLLOW) == 0) {
        have_lock = 1;
        if (read_lock_owner(quarantine_fd, &lock_owner, &lock_owner_length) != 0
            || lock_owner_length > MAX_INPUT_BYTES - total) result = -1;
    } else if (result == 0 && errno != ENOENT) {
        result = -1;
    }
    close(quarantine_fd);
    close(transaction_fd);
    if (result != 0) {
        for (size_t index = 0U; index < 3U; index += 1U) free(records[index]);
        free(lock_owner);
        return emit_recovery_required("transaction_records_unavailable");
    }
    char *encoded[3] = {NULL, NULL, NULL};
    for (size_t index = 0U; index < 3U; index += 1U) {
        encoded[index] = base64_encode(records[index], lengths[index]);
        free(records[index]);
        if (encoded[index] == NULL) result = -1;
    }
    if (result != 0) {
        for (size_t index = 0U; index < 3U; index += 1U) free(encoded[index]);
        free(lock_owner);
        return emit_recovery_required("transaction_records_unavailable");
    }
    char *encoded_lock = have_lock ? base64_encode(lock_owner, lock_owner_length) : NULL;
    free(lock_owner);
    if (have_lock && encoded_lock == NULL) {
        for (size_t index = 0U; index < 3U; index += 1U) free(encoded[index]);
        return emit_recovery_required("transaction_records_unavailable");
    }
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"probe-transaction\","
           "\"plan_base64\":\"%s\",\"manifest_base64\":\"%s\",\"state_base64\":\"%s\","
           "\"lock_base64\":",
           HELPER_PROTOCOL, encoded[0], encoded[1], encoded[2]);
    if (encoded_lock == NULL) printf("null");
    else printf("\"%s\"", encoded_lock);
    printf("}\n");
    for (size_t index = 0U; index < 3U; index += 1U) free(encoded[index]);
    free(encoded_lock);
    return 0;
}

static int process_start_identity(pid_t pid, uint64_t *seconds, uint64_t *microseconds) {
    struct proc_bsdinfo information;
    int bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &information, sizeof(information));
    if (bytes != (int)sizeof(information)) return -1;
    *seconds = information.pbi_start_tvsec;
    *microseconds = information.pbi_start_tvusec;
    return 0;
}

static int parse_pid(const char *value, pid_t *pid) {
    if (value == NULL || value[0] == '\0') return -1;
    errno = 0;
    char *end = NULL;
    unsigned long parsed = strtoul(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed == 0U || parsed > INT_MAX) return -1;
    *pid = (pid_t)parsed;
    return 0;
}

static int format_lock_owner(char *output, size_t output_size,
                             const char *transaction_id, const char *plan_hash,
                             const char *nonce, pid_t pid,
                             uint64_t start_seconds, uint64_t start_microseconds) {
    int length = snprintf(
        output,
        output_size,
        "{\"nonce\":\"%s\",\"pid\":%d,\"plan_hash\":\"%s\","
        "\"process_start_sec\":%llu,\"process_start_usec\":%llu,"
        "\"transaction_id\":\"%s\"}",
        nonce,
        pid,
        plan_hash,
        (unsigned long long)start_seconds,
        (unsigned long long)start_microseconds,
        transaction_id
    );
    return length < 0 || (size_t)length >= output_size ? -1 : length;
}

static int lock_acquire(const char *home_path, const char *transaction_id,
                        const char *plan_hash, const char *nonce, const char *pid_value) {
    pid_t pid;
    uint64_t start_seconds;
    uint64_t start_microseconds;
    if (!valid_sha256_identifier(transaction_id) || !valid_sha256_identifier(plan_hash)
        || !valid_lower_hex(nonce, 64U) || parse_pid(pid_value, &pid) != 0
        || pid != getppid()
        || process_start_identity(pid, &start_seconds, &start_microseconds) != 0) {
        return emit_error("invalid_lock_identity");
    }
    char owner[1024];
    int owner_length = format_lock_owner(
        owner,
        sizeof(owner),
        transaction_id,
        plan_hash,
        nonce,
        pid,
        start_seconds,
        start_microseconds
    );
    if (owner_length < 0) return emit_error("invalid_lock_identity");
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 0);
    close(home_fd);
    if (quarantine_fd < 0) return emit_error("unsafe_lock_root");
    char temporary[NAME_MAX + 1U];
    int temporary_length = snprintf(temporary, sizeof(temporary), ".skills-refiner-lock-%ld-%08x",
        (long)getpid(), arc4random());
    int result = temporary_length < 0 || (size_t)temporary_length >= sizeof(temporary)
        ? -1
        : mkdirat(quarantine_fd, temporary, 0700);
    int temporary_fd = result == 0
        ? openat(quarantine_fd, temporary, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        : -1;
    if (temporary_fd < 0 || fchmod(temporary_fd, 0700) != 0
        || write_new_record(temporary_fd, "owner.json", (const unsigned char *)owner,
                            (size_t)owner_length) != 0
        || fsync(temporary_fd) != 0) result = -1;
    if (temporary_fd >= 0) close(temporary_fd);
    if (result != 0) {
        int cleanup_fd = openat(quarantine_fd, temporary, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (cleanup_fd >= 0) {
            unlinkat(cleanup_fd, "owner.json", 0);
            close(cleanup_fd);
        }
        unlinkat(quarantine_fd, temporary, AT_REMOVEDIR);
        close(quarantine_fd);
        return emit_error("lock_acquire_failed");
    }
    crash_at_test_seam("before_lock_publish");
    int renamed = renameatx_np(quarantine_fd, temporary, quarantine_fd, "lock", RENAME_EXCL);
    int rename_errno = errno;
    if (renamed != 0) {
        int cleanup_fd = openat(quarantine_fd, temporary, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (cleanup_fd >= 0) {
            unlinkat(cleanup_fd, "owner.json", 0);
            close(cleanup_fd);
        }
        unlinkat(quarantine_fd, temporary, AT_REMOVEDIR);
        close(quarantine_fd);
        if (rename_errno == EEXIST) return emit_error("lock_held");
        return emit_error("lock_acquire_failed");
    }
    crash_at_test_seam("after_lock_publish");
    int durable = fsync(quarantine_fd) == 0;
    close(quarantine_fd);
    if (!durable) return emit_recovery_required("lock_durability_unknown");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"lock-acquire\","
           "\"owner\":%s}\n", HELPER_PROTOCOL, owner);
    return 0;
}

static int read_lock_owner(int quarantine_fd, unsigned char **bytes, size_t *length) {
    int lock_fd = openat(quarantine_fd, "lock", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (lock_fd < 0 || verify_directory_fd(lock_fd, 1) != 0) {
        if (lock_fd >= 0) close(lock_fd);
        return -1;
    }
    int result = read_transaction_record(lock_fd, "owner.json", bytes, length);
    close(lock_fd);
    return result;
}

static int move_lock_to_transaction(const char *home_path, const char *transaction_id,
                                    const char *plan_hash, const char *nonce,
                                    const char *pid_value, const char *start_seconds_value,
                                    const char *start_microseconds_value, int require_stale) {
    pid_t pid;
    if (!valid_sha256_identifier(transaction_id) || !valid_sha256_identifier(plan_hash)
        || !valid_lower_hex(nonce, 64U) || parse_pid(pid_value, &pid) != 0) {
        return emit_error("invalid_lock_identity");
    }
    const char *storage_key = transaction_id + 7U;
    errno = 0;
    char *seconds_end = NULL;
    char *microseconds_end = NULL;
    unsigned long long start_seconds = strtoull(start_seconds_value, &seconds_end, 10);
    unsigned long long start_microseconds = strtoull(start_microseconds_value, &microseconds_end, 10);
    if (errno != 0 || seconds_end == start_seconds_value || *seconds_end != '\0'
        || microseconds_end == start_microseconds_value || *microseconds_end != '\0') {
        return emit_error("invalid_lock_identity");
    }
    char expected[1024];
    int expected_length = format_lock_owner(
        expected,
        sizeof(expected),
        transaction_id,
        plan_hash,
        nonce,
        pid,
        (uint64_t)start_seconds,
        (uint64_t)start_microseconds
    );
    if (expected_length < 0) return emit_error("invalid_lock_identity");
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 0);
    int transactions_fd = quarantine_fd < 0
        ? -1
        : open_relative_directory(quarantine_fd, "transactions", 0, 1);
    int transaction_fd = transactions_fd < 0
        ? -1
        : openat(transactions_fd, storage_key, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (transactions_fd >= 0) close(transactions_fd);
    close(home_fd);
    if (quarantine_fd < 0 || transaction_fd < 0 || verify_directory_fd(transaction_fd, 1) != 0) {
        if (quarantine_fd >= 0) close(quarantine_fd);
        if (transaction_fd >= 0) close(transaction_fd);
        return emit_recovery_required("lock_identity_unavailable");
    }
    unsigned char *observed = NULL;
    size_t observed_length = 0U;
    if (read_lock_owner(quarantine_fd, &observed, &observed_length) != 0
        || observed_length != (size_t)expected_length
        || memcmp(observed, expected, observed_length) != 0) {
        free(observed);
        close(quarantine_fd);
        close(transaction_fd);
        return emit_recovery_required("lock_identity_mismatch");
    }
    free(observed);
    if (require_stale) {
        uint64_t live_seconds;
        uint64_t live_microseconds;
        if (process_start_identity(pid, &live_seconds, &live_microseconds) == 0
            && live_seconds == (uint64_t)start_seconds
            && live_microseconds == (uint64_t)start_microseconds) {
            close(quarantine_fd);
            close(transaction_fd);
            return emit_error("lock_live");
        }
        int kill_result = kill(pid, 0);
        int kill_errno = errno;
        if (kill_result == 0 || kill_errno == EPERM) {
            uint64_t retry_seconds;
            uint64_t retry_microseconds;
            if (process_start_identity(pid, &retry_seconds, &retry_microseconds) != 0) {
                close(quarantine_fd);
                close(transaction_fd);
                return emit_recovery_required("lock_liveness_ambiguous");
            }
            if (retry_seconds == (uint64_t)start_seconds
                && retry_microseconds == (uint64_t)start_microseconds) {
                close(quarantine_fd);
                close(transaction_fd);
                return emit_error("lock_live");
            }
        } else if (kill_errno != ESRCH) {
            close(quarantine_fd);
            close(transaction_fd);
            return emit_recovery_required("lock_liveness_ambiguous");
        }
    } else {
        uint64_t live_seconds;
        uint64_t live_microseconds;
        if (pid != getppid()
            || process_start_identity(pid, &live_seconds, &live_microseconds) != 0
            || live_seconds != (uint64_t)start_seconds
            || live_microseconds != (uint64_t)start_microseconds) {
            close(quarantine_fd);
            close(transaction_fd);
            return emit_error("lock_release_not_owner");
        }
    }
    char destination[NAME_MAX + 1U];
    int destination_length = snprintf(destination, sizeof(destination), "%s-lock-%s",
        require_stale ? "stale" : "released", nonce);
    int renamed = destination_length < 0 || (size_t)destination_length >= sizeof(destination)
        ? -1
        : renameatx_np(quarantine_fd, "lock", transaction_fd, destination, RENAME_EXCL);
    int rename_errno = errno;
    if (renamed != 0) {
        close(quarantine_fd);
        close(transaction_fd);
        if (rename_errno == EEXIST) return emit_recovery_required("lock_archive_conflict");
        return emit_recovery_required("lock_move_ambiguous");
    }
    int durable = fsync(quarantine_fd) == 0 && fsync(transaction_fd) == 0;
    close(quarantine_fd);
    close(transaction_fd);
    if (!durable) return emit_recovery_required("lock_durability_unknown");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"%s\"}\n",
           HELPER_PROTOCOL, require_stale ? "lock-isolate-stale" : "lock-release");
    return 0;
}

static int transaction_advance(const char *home_path, const char *transaction_id,
                               const char *plan_hash, const char *expected_state_hash,
                               const char *nonce, const char *pid_value,
                               const char *start_seconds_value,
                               const char *start_microseconds_value,
                               const char *expected_sequence_value,
                               const char *next_sequence_value) {
    pid_t pid;
    if (!valid_sha256_identifier(transaction_id) || !valid_sha256_identifier(plan_hash)
        || !valid_sha256_identifier(expected_state_hash) || !valid_lower_hex(nonce, 64U)
        || parse_pid(pid_value, &pid) != 0 || pid != getppid()) {
        return emit_error("invalid_state_lease");
    }
    errno = 0;
    char *expected_sequence_end = NULL;
    unsigned long long expected_sequence = strtoull(
        expected_sequence_value,
        &expected_sequence_end,
        10
    );
    if (errno != 0 || expected_sequence_end == expected_sequence_value
        || *expected_sequence_end != '\0') return emit_error("invalid_state_sequence");
    errno = 0;
    char *next_sequence_end = NULL;
    unsigned long long next_sequence = strtoull(next_sequence_value, &next_sequence_end, 10);
    if (errno != 0 || next_sequence_end == next_sequence_value || *next_sequence_end != '\0'
        || expected_sequence >= MAX_SAFE_JSON_INTEGER
        || next_sequence != expected_sequence + 1U) {
        return emit_error("invalid_state_sequence");
    }
    errno = 0;
    char *seconds_end = NULL;
    unsigned long long start_seconds = strtoull(start_seconds_value, &seconds_end, 10);
    if (errno != 0 || seconds_end == start_seconds_value || *seconds_end != '\0') {
        return emit_error("invalid_state_lease");
    }
    errno = 0;
    char *microseconds_end = NULL;
    unsigned long long start_microseconds = strtoull(
        start_microseconds_value,
        &microseconds_end,
        10
    );
    if (errno != 0 || microseconds_end == start_microseconds_value || *microseconds_end != '\0') {
        return emit_error("invalid_state_lease");
    }
    uint64_t live_seconds;
    uint64_t live_microseconds;
    if (process_start_identity(pid, &live_seconds, &live_microseconds) != 0
        || live_seconds != (uint64_t)start_seconds
        || live_microseconds != (uint64_t)start_microseconds) {
        return emit_error("state_lease_not_live");
    }
    char expected_owner[1024];
    int expected_owner_length = format_lock_owner(
        expected_owner,
        sizeof(expected_owner),
        transaction_id,
        plan_hash,
        nonce,
        pid,
        (uint64_t)start_seconds,
        (uint64_t)start_microseconds
    );
    if (expected_owner_length < 0) return emit_error("invalid_state_lease");
    unsigned char *next_state = NULL;
    size_t next_state_length = 0U;
    if (read_bounded_stdin(&next_state, &next_state_length) != 0 || next_state_length == 0U) {
        free(next_state);
        return emit_error("state_input_invalid");
    }
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        free(next_state);
        return emit_error("unsafe_home");
    }
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 0);
    int transactions_fd = quarantine_fd < 0
        ? -1
        : open_relative_directory(quarantine_fd, "transactions", 0, 1);
    int transaction_fd = transactions_fd < 0
        ? -1
        : openat(transactions_fd, transaction_id + 7U, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (transactions_fd >= 0) close(transactions_fd);
    close(home_fd);
    if (quarantine_fd < 0 || transaction_fd < 0 || verify_directory_fd(transaction_fd, 1) != 0) {
        if (quarantine_fd >= 0) close(quarantine_fd);
        if (transaction_fd >= 0) close(transaction_fd);
        free(next_state);
        return emit_recovery_required("transaction_records_unavailable");
    }
    if (flock(transaction_fd, LOCK_EX | LOCK_NB) != 0) {
        int lock_errno = errno;
        close(quarantine_fd);
        close(transaction_fd);
        free(next_state);
        if (lock_errno == EWOULDBLOCK) return emit_error("state_cas_mismatch");
        return emit_recovery_required("state_cas_lock_unavailable");
    }
    unsigned char *observed_owner = NULL;
    size_t observed_owner_length = 0U;
    if (read_lock_owner(quarantine_fd, &observed_owner, &observed_owner_length) != 0
        || observed_owner_length != (size_t)expected_owner_length
        || memcmp(observed_owner, expected_owner, observed_owner_length) != 0) {
        free(observed_owner);
        close(quarantine_fd);
        close(transaction_fd);
        free(next_state);
        return emit_error("state_lease_mismatch");
    }
    free(observed_owner);
    close(quarantine_fd);
    int state_fd = openat(transaction_fd, "state.json", O_RDONLY | O_NOFOLLOW);
    struct stat state_status;
    unsigned char *current_state = NULL;
    size_t current_state_length = 0U;
    char current_digest[SHA256_HEX_BYTES];
    int state_valid = state_fd >= 0 && fstat(state_fd, &state_status) == 0
        && (state_status.st_mode & 0777) == 0600
        && read_regular_fd_bounded(
            state_fd,
            &current_state,
            &current_state_length,
            current_digest,
            MAX_INPUT_BYTES
        ) == 0;
    if (state_fd >= 0) close(state_fd);
    if (!state_valid || strcmp(expected_state_hash + 7U, current_digest) != 0) {
        free(current_state);
        close(transaction_fd);
        free(next_state);
        return emit_error(state_valid ? "state_cas_mismatch" : "transaction_records_unavailable");
    }
    char current_sequence_token[64];
    char next_sequence_token[64];
    int current_sequence_length = snprintf(
        current_sequence_token,
        sizeof(current_sequence_token),
        ",\"sequence\":%llu,\"state\":",
        expected_sequence
    );
    int next_sequence_length = snprintf(
        next_sequence_token,
        sizeof(next_sequence_token),
        ",\"sequence\":%llu,\"state\":",
        next_sequence
    );
    if (current_sequence_length < 0 || next_sequence_length < 0
        || (size_t)current_sequence_length >= sizeof(current_sequence_token)
        || (size_t)next_sequence_length >= sizeof(next_sequence_token)
        ) {
        free(current_state);
        close(transaction_fd);
        free(next_state);
        return emit_error("invalid_state_sequence");
    }
    unsigned char *current_sequence_position = memmem(
        current_state,
        current_state_length,
        current_sequence_token,
        (size_t)current_sequence_length
    );
    unsigned char *next_sequence_position = memmem(
        next_state,
        next_state_length,
        next_sequence_token,
        (size_t)next_sequence_length
    );
    if (current_sequence_position == NULL || next_sequence_position == NULL
        || memmem(
            current_sequence_position + 1U,
            current_state_length - (size_t)(current_sequence_position + 1U - current_state),
            current_sequence_token,
            (size_t)current_sequence_length
        ) != NULL
        || memmem(
            next_sequence_position + 1U,
            next_state_length - (size_t)(next_sequence_position + 1U - next_state),
            next_sequence_token,
            (size_t)next_sequence_length
        ) != NULL) {
        free(current_state);
        close(transaction_fd);
        free(next_state);
        return emit_error("invalid_state_sequence");
    }
    free(current_state);
    char temporary[NAME_MAX + 1U];
    int temporary_length = snprintf(temporary, sizeof(temporary), ".skills-refiner-state-%ld-%08x",
        (long)getpid(), arc4random());
    int temporary_fd = temporary_length < 0 || (size_t)temporary_length >= sizeof(temporary)
        ? -1
        : openat(transaction_fd, temporary, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
    int result = 0;
    int published = 0;
    if (temporary_fd < 0 || fchmod(temporary_fd, 0600) != 0) result = -1;
    size_t written = 0U;
    while (result == 0 && written < next_state_length) {
        ssize_t part = write(temporary_fd, next_state + written, next_state_length - written);
        if (part <= 0) result = -1;
        else written += (size_t)part;
    }
    if (temporary_fd >= 0) {
        int durable = result == 0 && fsync(temporary_fd) == 0;
        int closed = close(temporary_fd) == 0;
        if (!durable || !closed) result = -1;
    }
    if (result == 0) crash_at_test_seam("before_transaction_state_publish");
    if (result == 0 && renameat(transaction_fd, temporary, transaction_fd, "state.json") == 0) {
        published = 1;
        crash_at_test_seam("after_transaction_state_rename");
    } else if (result == 0) {
        result = -1;
    }
    if (result == 0 && fsync(transaction_fd) != 0) result = -1;
    if (!published) unlinkat(transaction_fd, temporary, 0);
    free(next_state);
    close(transaction_fd);
    if (result != 0 && published) return emit_recovery_required("state_durability_unknown");
    if (result != 0) return emit_error("state_publish_failed");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"transaction-advance\"}\n",
           HELPER_PROTOCOL);
    return 0;
}

static int directory_has_git_marker(int directory_fd) {
    struct stat marker;
    if (fstatat(directory_fd, ".git", &marker, AT_SYMLINK_NOFOLLOW) == 0) return 1;
    return errno == ENOENT ? 0 : -1;
}

static int open_active_directory_without_git(int home_fd, const char *active_relative,
                                             int *active_fd) {
    int current = dup(home_fd);
    if (current < 0) return -1;
    int marker = directory_has_git_marker(current);
    if (marker != 0) {
        close(current);
        return marker;
    }
    char *copy = strdup(active_relative);
    if (copy == NULL) {
        close(current);
        return -1;
    }
    char *component = copy;
    while (*component != '\0') {
        char *separator = strchr(component, '/');
        if (separator != NULL) *separator = '\0';
        if (!valid_component(component)) {
            free(copy);
            close(current);
            return -1;
        }
        int next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (next < 0) {
            free(copy);
            close(current);
            return -1;
        }
        close(current);
        current = next;
        marker = directory_has_git_marker(current);
        if (marker != 0) {
            free(copy);
            close(current);
            return marker;
        }
        if (separator == NULL) break;
        component = separator + 1;
    }
    free(copy);
    *active_fd = current;
    return 0;
}

static int active_directory_still_bound_without_git(int home_fd, const char *active_relative,
                                                    int bound_fd) {
    int observed_fd = -1;
    int result = open_active_directory_without_git(home_fd, active_relative, &observed_fd);
    if (result != 0) return result;
    struct stat observed;
    struct stat bound;
    int same_directory = fstat(observed_fd, &observed) == 0
        && fstat(bound_fd, &bound) == 0
        && observed.st_dev == bound.st_dev
        && observed.st_ino == bound.st_ino;
    close(observed_fd);
    if (!same_directory) return -1;
    return directory_has_git_marker(bound_fd);
}

static int reconcile_leaf(int parent_fd, const char *leaf,
                          const char *expected_device, const char *expected_inode,
                          const char *expected_manifest, int *present, int *matches) {
    struct stat status;
    if (fstatat(parent_fd, leaf, &status, AT_SYMLINK_NOFOLLOW) != 0) {
        if (errno == ENOENT) {
            *present = 0;
            *matches = 0;
            return 0;
        }
        return -1;
    }
    *present = 1;
    char actual_device[32];
    char actual_inode[32];
    int device_length = snprintf(actual_device, sizeof(actual_device), "%llu",
        (unsigned long long)status.st_dev);
    int inode_length = snprintf(actual_inode, sizeof(actual_inode), "%llu",
        (unsigned long long)status.st_ino);
    if (device_length < 0 || inode_length < 0
        || strcmp(actual_device, expected_device) != 0
        || strcmp(actual_inode, expected_inode) != 0) {
        *matches = 0;
        return 0;
    }
    entry_identity identity;
    enum identity_result identity_status = calculate_entry_identity(parent_fd, leaf, &status, &identity);
    if (identity_status != IDENTITY_OK) {
        *matches = 0;
        return 0;
    }
    char actual_manifest[sizeof("sha256:") + SHA256_HEX_BYTES];
    int manifest_length = snprintf(actual_manifest, sizeof(actual_manifest), "sha256:%s",
        identity.manifest_hex);
    free(identity.raw_target_base64);
    *matches = manifest_length >= 0 && (size_t)manifest_length < sizeof(actual_manifest)
        && strcmp(actual_manifest, expected_manifest) == 0;
    return 0;
}

static int reconcile_entry(const char *home_path, const char *active_root,
                           const char *entry_path, const char *transaction_id,
                           const char *payload_leaf, const char *expected_device,
                           const char *expected_inode, const char *expected_manifest) {
    char active_leaf[NAME_MAX + 1U];
    if (!allowed_active_root(home_path, active_root)
        || split_immediate_child(entry_path, active_root, active_leaf) != 0
        || !valid_sha256_identifier(transaction_id) || !valid_component(payload_leaf)) {
        return emit_error("invalid_reconcile_identity");
    }
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    const char *active_relative = relative_to_home(home_path, active_root);
    int active_fd = -1;
    int git_marker = active_relative == NULL
        ? -1
        : open_active_directory_without_git(home_fd, active_relative, &active_fd);
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 0);
    int transactions_fd = quarantine_fd < 0
        ? -1
        : open_relative_directory(quarantine_fd, "transactions", 0, 1);
    int transaction_fd = transactions_fd < 0
        ? -1
        : openat(transactions_fd, transaction_id + 7U, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    int payload_fd = transaction_fd < 0
        ? -1
        : openat(transaction_fd, "payload", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (quarantine_fd >= 0) close(quarantine_fd);
    if (transactions_fd >= 0) close(transactions_fd);
    if (transaction_fd >= 0) close(transaction_fd);
    close(home_fd);
    if (git_marker != 0) {
        if (active_fd >= 0) close(active_fd);
        if (payload_fd >= 0) close(payload_fd);
        return emit_error("authoring_source_changed");
    }
    if (active_fd < 0 || payload_fd < 0 || verify_directory_fd(payload_fd, 1) != 0) {
        if (active_fd >= 0) close(active_fd);
        if (payload_fd >= 0) close(payload_fd);
        return emit_recovery_required("reconcile_paths_unavailable");
    }
    int original_present = 0;
    int original_matches = 0;
    int payload_present = 0;
    int payload_matches = 0;
    int result = reconcile_leaf(
        active_fd,
        active_leaf,
        expected_device,
        expected_inode,
        expected_manifest,
        &original_present,
        &original_matches
    );
    if (result == 0) {
        result = reconcile_leaf(
            payload_fd,
            payload_leaf,
            expected_device,
            expected_inode,
            expected_manifest,
            &payload_present,
            &payload_matches
        );
    }
    close(active_fd);
    close(payload_fd);
    if (result != 0 || (payload_present && !payload_matches)) {
        return emit_recovery_required("reconcile_identity_mismatch");
    }
    const char *location;
    if (payload_present) {
        if (!original_present) location = "quarantine";
        else location = original_matches ? "both" : "rehydrated";
    } else if (!original_present) {
        location = "neither";
    } else {
        location = original_matches ? "original" : "original_drift";
    }
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"reconcile\","
           "\"location\":\"%s\",\"original_present\":%s,\"original_matches\":%s,"
           "\"payload_present\":%s,\"payload_matches\":%s}\n",
           HELPER_PROTOCOL,
           location,
           original_present ? "true" : "false",
           original_matches ? "true" : "false",
           payload_present ? "true" : "false",
           payload_matches ? "true" : "false");
    return 0;
}

static int rename_exclusive(const char *home_path, const char *active_root, const char *entry_path,
                            const char *destination_relative, const char *destination_leaf,
                            const char *expected_device, const char *expected_inode,
                            const char *expected_manifest, const char *expected_receipt) {
    char source_leaf[NAME_MAX + 1U];
    if (!allowed_active_root(home_path, active_root)
        || split_immediate_child(entry_path, active_root, source_leaf) != 0
        || !valid_component(destination_leaf)) return emit_error("not_immediate_child");
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    const char *active_relative = relative_to_home(home_path, active_root);
    int source_fd = -1;
    int active_git_marker = active_relative == NULL
        ? -1
        : open_active_directory_without_git(home_fd, active_relative, &source_fd);
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 1);
    int destination_fd = quarantine_fd;
    if (quarantine_fd >= 0 && strcmp(destination_relative, ".") != 0) {
        destination_fd = open_relative_directory(quarantine_fd, destination_relative, 1, 1);
        close(quarantine_fd);
    }
    if (active_git_marker != 0 || source_fd < 0 || destination_fd < 0) {
        if (source_fd >= 0) close(source_fd);
        if (destination_fd >= 0) close(destination_fd);
        close(home_fd);
        return emit_error(active_git_marker == 0
            ? "unsafe_rename_parent"
            : "authoring_source_changed");
    }
    struct stat source_parent;
    struct stat destination_parent;
    struct stat source_before;
    if (fstat(source_fd, &source_parent) != 0 || fstat(destination_fd, &destination_parent) != 0
        || source_parent.st_dev != destination_parent.st_dev
        || fstatat(source_fd, source_leaf, &source_before, AT_SYMLINK_NOFOLLOW) != 0) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("cross_device_or_missing_source");
    }
    char actual_device[32];
    char actual_inode[32];
    int device_length = snprintf(actual_device, sizeof(actual_device), "%llu",
        (unsigned long long)source_before.st_dev);
    int inode_length = snprintf(actual_inode, sizeof(actual_inode), "%llu",
        (unsigned long long)source_before.st_ino);
    if (device_length < 0 || inode_length < 0
        || strcmp(actual_device, expected_device) != 0 || strcmp(actual_inode, expected_inode) != 0) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("identity_changed");
    }
    entry_identity current_identity;
    enum identity_result identity_status = calculate_entry_identity(
        source_fd,
        source_leaf,
        &source_before,
        &current_identity
    );
    if (identity_status == IDENTITY_AUTHORING_SOURCE) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("authoring_source_changed");
    }
    char actual_manifest[sizeof("sha256:") + SHA256_HEX_BYTES];
    int manifest_length = identity_status == IDENTITY_OK
        ? snprintf(actual_manifest, sizeof(actual_manifest), "sha256:%s", current_identity.manifest_hex)
        : -1;
    if (identity_status != IDENTITY_OK || manifest_length < 0
        || (size_t)manifest_length >= sizeof(actual_manifest)
        || strcmp(actual_manifest, expected_manifest) != 0) {
        free(current_identity.raw_target_base64);
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("identity_changed");
    }
    int directory_entry = strcmp(current_identity.kind, "directory") == 0;
    if (!directory_entry && strcmp(expected_receipt, "-") != 0) {
        free(current_identity.raw_target_base64);
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("identity_changed");
    }
    free(current_identity.raw_target_base64);
    struct stat source_revalidated;
    entry_identity revalidated_identity;
    enum identity_result revalidated_status = fstatat(
        source_fd,
        source_leaf,
        &source_revalidated,
        AT_SYMLINK_NOFOLLOW
    ) == 0
        && source_revalidated.st_dev == source_before.st_dev
        && source_revalidated.st_ino == source_before.st_ino
        ? calculate_entry_identity(source_fd, source_leaf, &source_revalidated, &revalidated_identity)
        : IDENTITY_UNAVAILABLE;
    char revalidated_manifest[sizeof("sha256:") + SHA256_HEX_BYTES];
    int revalidated_manifest_length = revalidated_status == IDENTITY_OK
        ? snprintf(revalidated_manifest, sizeof(revalidated_manifest), "sha256:%s",
                   revalidated_identity.manifest_hex)
        : -1;
    int revalidated_matches = revalidated_status == IDENTITY_OK
        && revalidated_manifest_length >= 0
        && (size_t)revalidated_manifest_length < sizeof(revalidated_manifest)
        && strcmp(revalidated_manifest, expected_manifest) == 0;
    if (revalidated_status == IDENTITY_OK) free(revalidated_identity.raw_target_base64);
    if (!revalidated_matches) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error(revalidated_status == IDENTITY_AUTHORING_SOURCE
            ? "authoring_source_changed"
            : "identity_changed");
    }
    if (directory_entry) {
        char receipt_digest[SHA256_HEX_BYTES];
        if (hash_install_receipt_from_home_fd(home_fd, receipt_digest) != 0
            || strcmp(receipt_digest, expected_receipt) != 0) {
            close(source_fd);
            close(destination_fd);
            close(home_fd);
            return emit_error("receipt_drift");
        }
    }
    int binding_status = active_directory_still_bound_without_git(
        home_fd,
        active_relative,
        source_fd
    );
    int entry_git_marker = 0;
    if (binding_status == 0 && directory_entry) {
        int entry_fd = openat(source_fd, source_leaf, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        entry_git_marker = entry_fd < 0 ? -1 : directory_has_git_marker(entry_fd);
        if (entry_fd >= 0) close(entry_fd);
    }
    if (binding_status != 0 || entry_git_marker != 0) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("authoring_source_changed");
    }
    close(home_fd);
    int rename_result = renameatx_np(source_fd, source_leaf, destination_fd, destination_leaf, RENAME_EXCL);
    int rename_errno = errno;
    if (rename_result != 0) {
        if (rename_errno == EEXIST) {
            struct stat source_conflict;
            struct stat destination_conflict;
            int destination_exists = fstatat(
                destination_fd,
                destination_leaf,
                &destination_conflict,
                AT_SYMLINK_NOFOLLOW
            ) == 0;
            int source_matches = fstatat(
                source_fd,
                source_leaf,
                &source_conflict,
                AT_SYMLINK_NOFOLLOW
            ) == 0 && source_conflict.st_dev == source_before.st_dev
                && source_conflict.st_ino == source_before.st_ino;
            entry_identity conflict_identity;
            enum identity_result conflict_status = source_matches
                ? calculate_entry_identity(source_fd, source_leaf, &source_conflict, &conflict_identity)
                : IDENTITY_UNAVAILABLE;
            char conflict_manifest[sizeof("sha256:") + SHA256_HEX_BYTES];
            int conflict_manifest_length = conflict_status == IDENTITY_OK
                ? snprintf(conflict_manifest, sizeof(conflict_manifest), "sha256:%s",
                           conflict_identity.manifest_hex)
                : -1;
            source_matches = source_matches && conflict_status == IDENTITY_OK
                && conflict_manifest_length >= 0
                && (size_t)conflict_manifest_length < sizeof(conflict_manifest)
                && strcmp(conflict_manifest, expected_manifest) == 0;
            if (conflict_status == IDENTITY_OK) free(conflict_identity.raw_target_base64);
            close(source_fd);
            close(destination_fd);
            if (source_matches && destination_exists) return emit_error("destination_exists");
            return emit_recovery_required("rename_conflict_recovery_required");
        }
        close(source_fd);
        close(destination_fd);
        if (rename_errno == EXDEV) return emit_error("cross_device");
        return emit_error("exclusive_rename_failed");
    }
    crash_at_test_seam("after_rename");
    struct stat source_after;
    struct stat destination_after;
    int source_absent = fstatat(source_fd, source_leaf, &source_after, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT;
    int destination_matches = fstatat(destination_fd, destination_leaf, &destination_after, AT_SYMLINK_NOFOLLOW) == 0
        && destination_after.st_dev == source_before.st_dev && destination_after.st_ino == source_before.st_ino;
    entry_identity destination_identity;
    enum identity_result destination_status = destination_matches
        ? calculate_entry_identity(destination_fd, destination_leaf, &destination_after, &destination_identity)
        : IDENTITY_UNAVAILABLE;
    char destination_manifest[sizeof("sha256:") + SHA256_HEX_BYTES];
    int destination_manifest_length = destination_status == IDENTITY_OK
        ? snprintf(destination_manifest, sizeof(destination_manifest), "sha256:%s",
                   destination_identity.manifest_hex)
        : -1;
    destination_matches = destination_matches && destination_status == IDENTITY_OK
        && destination_manifest_length >= 0
        && (size_t)destination_manifest_length < sizeof(destination_manifest)
        && strcmp(destination_manifest, expected_manifest) == 0;
    if (destination_status == IDENTITY_OK) free(destination_identity.raw_target_base64);
    int source_durable = fsync(source_fd) == 0;
    int destination_durable = fsync(destination_fd) == 0;
    int durable = source_durable && destination_durable
        && !fail_at_test_seam("rename_parent_fsync");
    close(source_fd);
    close(destination_fd);
    if (!source_absent || !destination_matches || !durable) {
        return emit_recovery_required("rename_recovery_required");
    }
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"rename-exclusive\","
           "\"manifest_hash\":\"%s\"}\n",
           HELPER_PROTOCOL, destination_manifest);
    return 0;
}

static int restore_exclusive(const char *home_path, const char *active_root,
                             const char *entry_path, const char *transaction_id,
                             const char *payload_leaf, const char *expected_device,
                             const char *expected_inode, const char *expected_manifest) {
    char destination_leaf[NAME_MAX + 1U];
    if (!allowed_active_root(home_path, active_root)
        || split_immediate_child(entry_path, active_root, destination_leaf) != 0
        || !valid_sha256_identifier(transaction_id) || !valid_component(payload_leaf)) {
        return emit_error("invalid_restore_identity");
    }
    int home_fd = open_absolute_directory(home_path);
    if (home_fd < 0 || verify_directory_fd(home_fd, 0) != 0) {
        if (home_fd >= 0) close(home_fd);
        return emit_error("unsafe_home");
    }
    const char *active_relative = relative_to_home(home_path, active_root);
    int destination_fd = -1;
    int active_git_marker = active_relative == NULL
        ? -1
        : open_active_directory_without_git(home_fd, active_relative, &destination_fd);
    int quarantine_fd = open_private_agents_directory(home_fd, "skills-quarantine", 0);
    int transactions_fd = quarantine_fd < 0
        ? -1
        : open_relative_directory(quarantine_fd, "transactions", 0, 1);
    int transaction_fd = transactions_fd < 0
        ? -1
        : openat(transactions_fd, transaction_id + 7U, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    int source_fd = transaction_fd < 0
        ? -1
        : openat(transaction_fd, "payload", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (quarantine_fd >= 0) close(quarantine_fd);
    if (transactions_fd >= 0) close(transactions_fd);
    if (transaction_fd >= 0) close(transaction_fd);
    if (active_git_marker != 0) {
        if (source_fd >= 0) close(source_fd);
        if (destination_fd >= 0) close(destination_fd);
        close(home_fd);
        return emit_error("authoring_source_changed");
    }
    if (source_fd < 0 || destination_fd < 0 || verify_directory_fd(source_fd, 1) != 0) {
        if (source_fd >= 0) close(source_fd);
        if (destination_fd >= 0) close(destination_fd);
        close(home_fd);
        return emit_recovery_required("restore_paths_unavailable");
    }
    struct stat source_parent;
    struct stat destination_parent;
    int source_present = 0;
    int source_matches = 0;
    if (fstat(source_fd, &source_parent) != 0 || fstat(destination_fd, &destination_parent) != 0
        || source_parent.st_dev != destination_parent.st_dev
        || reconcile_leaf(
            source_fd,
            payload_leaf,
            expected_device,
            expected_inode,
            expected_manifest,
            &source_present,
            &source_matches
        ) != 0 || !source_present || !source_matches) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_recovery_required("restore_identity_mismatch");
    }
    struct stat occupied;
    if (fstatat(destination_fd, destination_leaf, &occupied, AT_SYMLINK_NOFOLLOW) == 0) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("restore_destination_occupied");
    }
    if (errno != ENOENT) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_recovery_required("restore_destination_ambiguous");
    }
    int binding_status = active_directory_still_bound_without_git(
        home_fd,
        active_relative,
        destination_fd
    );
    if (binding_status != 0) {
        close(source_fd);
        close(destination_fd);
        close(home_fd);
        return emit_error("authoring_source_changed");
    }
    close(home_fd);
    int renamed = renameatx_np(
        source_fd,
        payload_leaf,
        destination_fd,
        destination_leaf,
        RENAME_EXCL
    );
    int rename_errno = errno;
    if (renamed != 0) {
        int payload_still_present = 0;
        int payload_still_matches = 0;
        struct stat destination_after_failure;
        int destination_exists = fstatat(
            destination_fd,
            destination_leaf,
            &destination_after_failure,
            AT_SYMLINK_NOFOLLOW
        ) == 0;
        int source_coherent = reconcile_leaf(
            source_fd,
            payload_leaf,
            expected_device,
            expected_inode,
            expected_manifest,
            &payload_still_present,
            &payload_still_matches
        ) == 0 && payload_still_present && payload_still_matches;
        close(source_fd);
        close(destination_fd);
        if (rename_errno == EEXIST && source_coherent && destination_exists) {
            return emit_error("restore_destination_occupied");
        }
        return emit_recovery_required("restore_move_ambiguous");
    }
    crash_at_test_seam("after_restore_rename");
    int payload_after_present = 0;
    int payload_after_matches = 0;
    int destination_after_present = 0;
    int destination_after_matches = 0;
    int postcondition = reconcile_leaf(
        source_fd,
        payload_leaf,
        expected_device,
        expected_inode,
        expected_manifest,
        &payload_after_present,
        &payload_after_matches
    ) == 0 && reconcile_leaf(
        destination_fd,
        destination_leaf,
        expected_device,
        expected_inode,
        expected_manifest,
        &destination_after_present,
        &destination_after_matches
    ) == 0 && !payload_after_present && destination_after_present && destination_after_matches;
    int source_durable = fsync(source_fd) == 0;
    int destination_durable = fsync(destination_fd) == 0;
    close(source_fd);
    close(destination_fd);
    if (!postcondition || !source_durable || !destination_durable) {
        return emit_recovery_required("restore_recovery_required");
    }
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"restore-exclusive\","
           "\"manifest_hash\":\"%s\"}\n",
           HELPER_PROTOCOL, expected_manifest);
    return 0;
}

static int emit_identity(void) {
    struct utsname information;
    if (uname(&information) != 0) return emit_error("identity_unavailable");
    printf("{\"protocol\":\"%s\",\"status\":\"ok\",\"operation\":\"identity\","
           "\"architecture\":\"%s\",\"source_sha256\":\"%s\","
           "\"compiler_path\":\"%s\",\"compiler_version\":\"%s\"}\n",
           HELPER_PROTOCOL, information.machine, SR_SOURCE_SHA256,
           SR_COMPILER_PATH, SR_COMPILER_VERSION);
    return 0;
}

int main(int argument_count, char **arguments) {
    (void)umask(0077);
    if (argument_count < 2) return emit_error("invalid_invocation");
    const char *command = arguments[1];
    if (strcmp(command, "identity") == 0 && argument_count == 2) return emit_identity();
    if (strcmp(command, "inspect") == 0 && argument_count == 5) {
        return inspect_entry(arguments[2], arguments[3], arguments[4]);
    }
    if (strcmp(command, "hash-install-receipt") == 0 && argument_count == 3) {
        return hash_install_receipt(arguments[2]);
    }
    if (strcmp(command, "install-self") == 0 && argument_count == 5) {
        return install_self(arguments[2], arguments[3], arguments[4], arguments[0]);
    }
    if (strcmp(command, "publish-state") == 0 && argument_count == 6) {
        return publish_state(arguments[2], arguments[3], arguments[4], arguments[5]);
    }
    if (strcmp(command, "transaction-init") == 0 && argument_count == 4) {
        return transaction_init(arguments[2], arguments[3]);
    }
    if (strcmp(command, "probe-transaction") == 0 && argument_count == 4) {
        return probe_transaction(arguments[2], arguments[3]);
    }
    if (strcmp(command, "lock-acquire") == 0 && argument_count == 7) {
        return lock_acquire(arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]);
    }
    if (strcmp(command, "lock-release") == 0 && argument_count == 9) {
        return move_lock_to_transaction(
            arguments[2], arguments[3], arguments[4], arguments[5], arguments[6],
            arguments[7], arguments[8], 0
        );
    }
    if (strcmp(command, "lock-isolate-stale") == 0 && argument_count == 9) {
        return move_lock_to_transaction(
            arguments[2], arguments[3], arguments[4], arguments[5], arguments[6],
            arguments[7], arguments[8], 1
        );
    }
    if (strcmp(command, "transaction-advance") == 0 && argument_count == 12) {
        return transaction_advance(
            arguments[2], arguments[3], arguments[4], arguments[5], arguments[6],
            arguments[7], arguments[8], arguments[9], arguments[10], arguments[11]
        );
    }
    if (strcmp(command, "reconcile") == 0 && argument_count == 10) {
        return reconcile_entry(
            arguments[2], arguments[3], arguments[4], arguments[5], arguments[6],
            arguments[7], arguments[8], arguments[9]
        );
    }
    if (strcmp(command, "restore-exclusive") == 0 && argument_count == 10) {
        return restore_exclusive(
            arguments[2], arguments[3], arguments[4], arguments[5], arguments[6],
            arguments[7], arguments[8], arguments[9]
        );
    }
    if (strcmp(command, "rename-exclusive") == 0 && argument_count == 11) {
        return rename_exclusive(arguments[2], arguments[3], arguments[4], arguments[5], arguments[6],
                                arguments[7], arguments[8], arguments[9], arguments[10]);
    }
    return emit_error("unsupported_command");
}
