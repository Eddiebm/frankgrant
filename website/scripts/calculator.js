// FrankGrant — ROI Calculator
document.addEventListener('DOMContentLoaded', function() {
  var awardInput = document.getElementById('calc-award');
  var mechanismSelect = document.getElementById('calc-mechanism');

  if (!awardInput) return;

  var upfrontFees = {
    'sbir-i':    2500,
    'sbir-ii':   4500,
    'sttr-i':    2500,
    'sttr-ii':   4500,
    'fast-track': 5000,
    'r01':       3500,
    'r21':       2000,
  };

  var consultantCosts = {
    'sbir-i':    7500,
    'sbir-ii':   15000,
    'sttr-i':    7500,
    'sttr-ii':   15000,
    'fast-track': 18000,
    'r01':       14000,
    'r21':       9000,
  };

  var mechanismAwards = {
    'sbir-i':    300000,
    'sbir-ii':   1500000,
    'sttr-i':    300000,
    'sttr-ii':   2000000,
    'fast-track': 1750000,
    'r01':       2500000,
    'r21':       275000,
  };

  function fmt(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  function calculate() {
    var mech = mechanismSelect ? mechanismSelect.value : 'sbir-i';
    var inputVal = parseFloat(awardInput.value);
    var award = isNaN(inputVal) ? mechanismAwards[mech] || 0 : inputVal;
    var upfront = upfrontFees[mech] || 2500;
    var successFee = award * 0.03;
    var total = upfront + successFee;
    var consultant = consultantCosts[mech] || 7500;
    var savings = consultant - upfront;

    var upfrontEl = document.getElementById('calc-upfront');
    var successEl = document.getElementById('calc-success');
    var totalEl = document.getElementById('calc-total');
    var savingsEl = document.getElementById('calc-savings');

    if (upfrontEl) upfrontEl.textContent = fmt(upfront);
    if (successEl) successEl.textContent = award > 0 ? fmt(successFee) : '—';
    if (totalEl) totalEl.textContent = award > 0 ? fmt(total) : fmt(upfront) + '+';
    if (savingsEl) savingsEl.textContent = fmt(savings);

    // Update savings message
    var savingsMsgEl = document.getElementById('calc-savings-msg');
    if (savingsMsgEl) {
      savingsMsgEl.innerHTML = 'You save <strong>' + fmt(savings) + '</strong> upfront vs. a traditional consultant. ' +
        (award > 0 ? 'If funded, your total investment is <strong>' + fmt(total) + '</strong> against a <strong>' + fmt(award) + '</strong> award — a ' + (total / award * 100).toFixed(1) + '% investment.' : '');
    }
  }

  // Set default award value hint when mechanism changes
  if (mechanismSelect) {
    mechanismSelect.addEventListener('change', function() {
      var mech = this.value;
      awardInput.placeholder = mechanismAwards[mech] ? mechanismAwards[mech].toLocaleString() : '300000';
      calculate();
    });
  }

  awardInput.addEventListener('input', calculate);
  calculate();
});
