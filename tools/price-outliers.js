function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return null;
  const position = Math.min(sortedValues.length - 1, Math.max(0, (sortedValues.length - 1) * ratio));
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  const value = sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
  return Number(value.toFixed(2));
}

function median(sortedValues) {
  if (!sortedValues.length) return null;
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2) return sortedValues[middle];
  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function removePriceOutliers(sortedValues) {
  if (sortedValues.length < 2) {
    return { values: sortedValues, outlierCount: 0 };
  }

  if (sortedValues.length === 2) {
    const [low, high] = sortedValues;
    if (high > low * 5 && high - low > 1000) {
      return { values: [low], outlierCount: 1 };
    }
    return { values: sortedValues, outlierCount: 0 };
  }

  const center = median(sortedValues);
  if (!center || center <= 0) {
    return { values: sortedValues, outlierCount: 0 };
  }

  const minAllowed = center / 5;
  const maxAllowed = center * 3;
  let values = sortedValues.filter((value) => {
    const highOutlier = value > maxAllowed && value - center > 1000;
    const lowOutlier = value < minAllowed && center - value > 100;
    return !highOutlier && !lowOutlier;
  });

  if (values.length >= 3) {
    const high = values[values.length - 1];
    const secondHigh = values[values.length - 2];
    if (high > secondHigh * 2 && high - secondHigh > 1000) {
      values = values.slice(0, -1);
    }
  }

  return {
    values: values.length ? values : sortedValues,
    outlierCount: sortedValues.length - values.length,
  };
}

module.exports = {
  median,
  percentile,
  removePriceOutliers,
};
