#ifndef VW_FTMS_CONTROL_H
#define VW_FTMS_CONTROL_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef struct { uint16_t min, max, increment; } VWSpeedRange;
static inline uint16_t VWReadLE16(const uint8_t *p) { return (uint16_t)(p[0] | ((uint16_t)p[1] << 8)); }
static inline bool VWReadSpeedRange(const uint8_t *p, size_t length, VWSpeedRange *range) {
    if (!p || length != 6 || !range) return false;
    range->min = VWReadLE16(p); range->max = VWReadLE16(p + 2); range->increment = VWReadLE16(p + 4);
    return range->max > range->min && range->increment > 0 && range->increment <= range->max - range->min;
}
static inline bool VWFTMSCommandAllowed(const uint8_t *p, size_t length, const uint8_t *features, size_t featureLength, const uint8_t *limits, size_t limitLength) {
    if (!p || !length) return false;
    if (length == 1 && (p[0] == 0 || p[0] == 7)) return true;
    if (length == 2 && p[0] == 8 && (p[1] == 1 || p[1] == 2)) return true;
    if (length != 3 || p[0] != 2 || !features || featureLength < 8 || !(features[4] & 1)) return false;
    VWSpeedRange range;
    if (!VWReadSpeedRange(limits, limitLength, &range)) return false;
    uint16_t target = VWReadLE16(p + 1);
    return target > 0 && target >= range.min && target <= range.max && (target - range.min) % range.increment == 0;
}
#endif
