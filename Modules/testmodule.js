ModuleRegistry.register({
    id: 'testmodule',
    name: 'Test Module',
    division: 'bakery',
    icon: '🧪',
    order: 10,
    init: async function() {
        console.log('[TestModule] Initialised');
    },
    render: async function(container) {
        container.innerHTML = '<div class="space-y-6 max-w-xl">' +
            '<div><h1 class="text-2xl font-black text-slate-800">Test Module</h1>' +
            '<p class="text-sm text-slate-400">Two-question validation module.</p></div>' +
            '<div class="card p-6 space-y-4">' +
            '<div>' +
            '<label class="block text-sm font-bold text-slate-600 mb-1">Question 1: Is the module system working?</label>' +
            '<select class="input-chip w-full">' +
            '<option value="">Select...</option>' +
            '<option value="yes">Yes</option>' +
            '<option value="no">No</option>' +
            '</select>' +
            '</div>' +
            '<div>' +
            '<label class="block text-sm font-bold text-slate-600 mb-1">Question 2: Any issues found?</label>' +
            '<textarea class="input-chip w-full" rows="3" placeholder="Describe any issues..."></textarea>' +
            '</div>' +
            '<button onclick="alert(\'Module system confirmed working!\')" class="btn-primary rounded-none">Submit</button>' +
            '</div></div>';
    },
    destroy: function() {
        console.log('[TestModule] Destroyed');
    }
});
