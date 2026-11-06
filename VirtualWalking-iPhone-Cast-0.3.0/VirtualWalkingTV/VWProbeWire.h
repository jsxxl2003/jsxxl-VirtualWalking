#ifndef VW_PROBE_WIRE_H
#define VW_PROBE_WIRE_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Small, bounded Cast v2 protobuf codec. No network operations or commands here.
typedef struct { const uint8_t *bytes; size_t length; } VWProbeSlice;
typedef struct { VWProbeSlice source, nameSpace, payload; } VWProbeEnvelope;
static int VWProbeVarint(const uint8_t *bytes, size_t length, size_t *offset, uint64_t *value) {
    *value = 0;
    for (unsigned shift = 0; shift <= 63; shift += 7) {
        if (*offset >= length) return 0;
        uint8_t part = bytes[(*offset)++];
        if (shift == 63 && part > 1) return 0;
        *value |= (uint64_t)(part & 127) << shift;
        if (!(part & 128)) return 1;
    }
    return 0;
}
static int VWProbeDecode(const uint8_t *bytes, size_t length, VWProbeEnvelope *envelope) {
    if (!bytes || !envelope || length > 262144) return 0;
    memset(envelope, 0, sizeof(*envelope)); size_t offset = 0;
    while (offset < length) {
        uint64_t key, count;
        if (!VWProbeVarint(bytes, length, &offset, &key) || !(key >> 3)) return 0;
        unsigned wire = key & 7; uint64_t field = key >> 3;
        if (!wire) { if (!VWProbeVarint(bytes, length, &offset, &count)) return 0; }
        else if (wire == 2) {
            if (!VWProbeVarint(bytes, length, &offset, &count) || count > length - offset) return 0;
            VWProbeSlice slice = {bytes + offset, (size_t)count};
            if (field == 2) envelope->source = slice;
            if (field == 4) envelope->nameSpace = slice;
            if (field == 6) envelope->payload = slice;
            offset += (size_t)count;
        } else if (wire == 1 || wire == 5) {
            size_t countBytes = wire == 1 ? 8 : 4;
            if (countBytes > length - offset) return 0; offset += countBytes;
        } else return 0;
    }
    return envelope->nameSpace.bytes && envelope->payload.bytes;
}
static int VWProbeAppendVarint(uint8_t *bytes, size_t capacity, size_t *offset, size_t value) {
    do {
        if (*offset >= capacity) return 0;
        uint8_t part = value & 127; value >>= 7;
        bytes[(*offset)++] = part | (value ? 128 : 0);
    } while (value);
    return 1;
}
static int VWProbeAppendField(uint8_t *bytes, size_t capacity, size_t *offset, unsigned field, const char *value) {
    size_t length = strlen(value);
    if (!VWProbeAppendVarint(bytes, capacity, offset, (field << 3) | 2) || !VWProbeAppendVarint(bytes, capacity, offset, length) || length > capacity - *offset) return 0;
    memcpy(bytes + *offset, value, length); *offset += length; return 1;
}
static size_t VWProbeEncode(uint8_t *bytes, size_t capacity, const char *destination, const char *nameSpace, const char *payload) {
    size_t offset = 4;
    if (capacity < 8 || !destination || !nameSpace || !payload) return 0;
    bytes[offset++] = 8; bytes[offset++] = 0;
    if (!VWProbeAppendField(bytes, capacity, &offset, 2, "sender-vw-probe") ||
        !VWProbeAppendField(bytes, capacity, &offset, 3, destination) ||
        !VWProbeAppendField(bytes, capacity, &offset, 4, nameSpace)) return 0;
    if (capacity - offset < 2) return 0; bytes[offset++] = 40; bytes[offset++] = 0;
    if (!VWProbeAppendField(bytes, capacity, &offset, 6, payload) || offset - 4 > 262144) return 0;
    uint32_t length = (uint32_t)(offset - 4);
    bytes[0] = length >> 24; bytes[1] = length >> 16; bytes[2] = length >> 8; bytes[3] = length;
    return offset;
}
#endif
